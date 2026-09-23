import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'reader-hud',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './reader-hud.component.html',
  styleUrl: './reader-hud.component.css'
})
export class ReaderHudComponent {
  @Input() visible = true;
  @Input() currentPage = 0;
  @Input() totalPages = 0;
  @Input() chapterOrder: number | null = null;
  @Input() bookmarked = false;
  @Input() bookmarkPending = false;

  @Output() bookmarkClicked = new EventEmitter<void>();
  @Output() settingsClicked = new EventEmitter<void>();
  @Output() interactionStarted = new EventEmitter<void>();
  @Output() interactionEnded = new EventEmitter<void>();
}
