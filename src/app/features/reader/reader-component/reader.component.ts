import { AfterViewInit, Component, Input, QueryList, ViewChildren, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'manga-reader',
  templateUrl: './reader.component.html',
  styleUrls: ['./reader.component.css'],
  standalone: true,
  imports: [CommonModule]
})
export class ReaderComponent implements AfterViewInit {
  @Input() pages: string[] = [];
  @Input() gap = 16;
  @Input() mode: 'scroll'|'page' = 'scroll';
  @Input() zoom = 1;

  observer!: IntersectionObserver;

  @ViewChildren('imgRef') imgRefs!: QueryList<ElementRef<HTMLImageElement>>;

  ngAfterViewInit(): void {
    this.observer = new IntersectionObserver((entries) => {
      for (let entry of entries) {
        if (entry.isIntersecting) {
          const img = entry.target as HTMLImageElement;
          img.src = img.dataset.src!;
          this.observer.unobserve(img);
        }
      }
    }, { rootMargin: '300px' });

    this.imgRefs.forEach(ref => this.observer.observe(ref.nativeElement));
  }
}
