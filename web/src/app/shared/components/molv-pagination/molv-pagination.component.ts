import { Component, computed, effect, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'molv-pagination',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './molv-pagination.component.html',
  styleUrls: ['./molv-pagination.component.css']
})
export class MolvPaginationComponent {
  totalTabs = input<number>(0);
  currentPage = input<number>(1);
  perPage = input<number>(10);

  pageChange = output<{ page: number; perPage: number }>();

  readonly maxVisiblePages = 5;

  totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalTabs() / this.perPage()))
  );

  pages = computed(() => {
    const total = this.totalPages();
    const current = this.currentPage();

    if (total === 0) return [];

    let start = Math.max(1, current - Math.floor(this.maxVisiblePages / 2));
    let end = Math.min(total, start + this.maxVisiblePages - 1);

    if (end - start + 1 < this.maxVisiblePages) {
      start = Math.max(1, end - this.maxVisiblePages + 1);
    }

    return Array.from(
      { length: end - start + 1 },
      (_, i) => start + i
    );
  });

  constructor() {
    effect(() => {
      if (this.totalTabs() === 0) return;

      const current = this.currentPage();
      const total = this.totalPages();

      if (current > total) {
        this.emitChange(total, this.perPage());
      }
    });
  }

  goToPage(page: number) {
    const target = Math.min(
      Math.max(1, page),
      this.totalPages()
    );

    this.emitChange(target, this.perPage());
  }

  changePerPage(value: number) {
    const perPage = Number(value);
    this.emitChange(1, perPage);
  }

  private emitChange(page: number, perPage: number) {
    this.pageChange.emit({ page, perPage });
  }
}
