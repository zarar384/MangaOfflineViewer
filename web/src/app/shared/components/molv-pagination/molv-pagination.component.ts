import { CommonModule } from '@angular/common';
import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject, combineLatest, map, startWith, Subscription } from 'rxjs';

@Component({
  selector: 'molv-pagination',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './molv-pagination.component.html',
  styleUrls: ['./molv-pagination.component.css']
})
export class MolvPaginationComponent implements OnInit, OnDestroy {
  private perPage$ = new BehaviorSubject<number>(10);
  private currentPage$ = new BehaviorSubject<number>(1);
  private totalTabs$ = new BehaviorSubject<number>(0);

  @Input() set perPage(value: number) {
    if (value != null) this.perPage$.next(value);
  }
  get perPage() {
    return this.perPage$.value;
  }

  @Input() set currentPage(value: number) {
    if (value != null) this.currentPage$.next(value);
  }
  get currentPage() {
    return this.currentPage$.value;
  }

  @Input() set totalTabs(value: number) {
    if (value != null) this.totalTabs$.next(value);
  }
  get totalTabs() {
    return this.totalTabs$.value;
  }

  @Output() pageChange = new EventEmitter<{ page: number; perPage: number }>();

  readonly maxVisiblePages = 5;

  pages: number[] = [];
  totalPages = 0;

  private sub = new Subscription();

  ngOnInit() {
    this.sub.add(
      combineLatest([
        this.totalTabs$.pipe(startWith(this.totalTabs)),
        this.perPage$.pipe(startWith(this.perPage)),
        this.currentPage$.pipe(startWith(this.currentPage))
      ]).subscribe(() => this.updatePages())
    );
  }

  goToPage(page: number) {
    if (page < 1) page = 1;
    if (page > this.totalPages) page = this.totalPages;
    this.currentPage$.next(page);
    this.pageChange.emit({ page, perPage: this.perPage });
  }

  changePerPage(value: number) {
    const perPage = Number(value);
    this.perPage$.next(perPage);
    this.currentPage$.next(1);
    this.pageChange.emit({ page: 1, perPage });
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
  }

  private updatePages() {
    this.totalPages = Math.ceil(this.totalTabs / this.perPage);

    if (this.currentPage > this.totalPages) {
      const newPage = this.totalPages || 1;
      if (this.currentPage !== newPage) {
        this.currentPage$.next(newPage);
        this.pageChange.emit({ page: newPage, perPage: this.perPage });
        return;
      }
    }

    let start = Math.max(1, this.currentPage - Math.floor(this.maxVisiblePages / 2));
    let end = Math.min(this.totalPages, start + this.maxVisiblePages - 1);

    if (end - start + 1 < this.maxVisiblePages) {
      start = Math.max(1, end - this.maxVisiblePages + 1);
    }

    const arr: number[] = [];
    for (let i = start; i <= end; i++) arr.push(i);
    this.pages = arr;
  }
}
