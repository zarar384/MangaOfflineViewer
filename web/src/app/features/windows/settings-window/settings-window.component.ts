import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageService } from 'src/app/core/services/language.service';
import { UiStateService } from 'src/app/core/services/ui-state.service';
import { MolvModule } from 'src/app/shared/components/molv-module.component';
import { WindowComponent } from 'src/app/shared/components/window/window.component';

@Component({
  selector: 'settings-window',
  imports: [CommonModule, WindowComponent, MolvModule, TranslocoPipe],
  templateUrl: './settings-window.component.html',
  styleUrl: './settings-window.component.css',
  standalone: true
})
export class SettingsWindowComponent {
  @Input() isVisible = false;
  @Output() hideWindow = new EventEmitter<void>();

  language = 'en';

  constructor(private langService: LanguageService, private uiState: UiStateService) {
    this.language = this.uiState.getValue<string>('language') || this.langService.getLang();
  }

  onWindowHide() {
    this.hideWindow.emit();
  }

  // LANGUAGE SETTINGS

  onLangChange(lang: 'en' | 'cs' | 'ru') {
    this.langService.setLang(lang);
    this.uiState.saveState({ language: this.language });
  }
}
