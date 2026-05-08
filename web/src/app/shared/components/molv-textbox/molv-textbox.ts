import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'molv-textbox',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './molv-textbox.html',
  styleUrls: ['./molv-textbox.css']
})
export class MolvTextboxComponent
  implements AfterViewInit, OnChanges {

  @ViewChild('textareaRef', { static: false })
  textareaRef?: ElementRef<HTMLTextAreaElement>;

  @Input() value: string = '';

  @Input() placeholder: string = '';

  @Input() isEditMode: boolean = true;

  // allow input-like textarea with auto grow
  @Input() multiline: boolean = false;

  // max text length
  @Input() maxLength: number = 5000;

  // max auto grow height
  @Input() maxHeight: number = 400;

  // extra css classes
  @Input() editClassName: string = '';
  @Input() readonlyClassName: string = '';

  // editable element
  @Input() editableTag: 'input' | 'textarea' = 'input';

  // readonly element
  @Input()
  readonlyTag: 'span' | 'div' | 'p' | 'h1' | 'h2' | 'h3' = 'span';

  @Output() valueChange = new EventEmitter<string>();

  ngAfterViewInit() {
    this.triggerResize();
  }

  ngOnChanges(changes: SimpleChanges) {

    // value changed from parent
    if (changes['value']) {
      this.triggerResize();
    }

    // edit mode toggled
    if (changes['isEditMode']) {
      this.triggerResize();
    }
  }

  onInputChange(val: string) {

    // hard limit
    if (val.length > this.maxLength) {
      val = val.slice(0, this.maxLength);
    }

    this.value = val;

    this.valueChange.emit(this.value);

    this.triggerResize();
  }

  stopClick(event: Event) {
    event.stopPropagation();
  }

  private shouldResize(): boolean {
    return this.editableTag === 'textarea' || this.multiline;
  }

  private triggerResize() {

    if (!this.shouldResize()) {
      return;
    }

    setTimeout(() => {
      this.resizeTextarea();
    });
  }

  private resizeTextarea() {

    if (!this.textareaRef) return;

    const textarea = this.textareaRef.nativeElement;

    // reset height
    textarea.style.height = 'auto';

    // clamp max height
    const nextHeight = Math.min(
      textarea.scrollHeight,
      this.maxHeight
    );

    textarea.style.height = nextHeight + 'px';

    // enable scroll after limit
    textarea.style.overflowY =
      textarea.scrollHeight > this.maxHeight
        ? 'auto'
        : 'hidden';
  }
}