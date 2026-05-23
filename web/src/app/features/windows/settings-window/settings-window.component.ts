import { CommonModule } from '@angular/common';
import { Component, EventEmitter, inject, Input, OnInit, Output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageService, SupportedLangs } from '../../../core/services/language.service';
import { UiStateService } from '../../../core/services/ui-state.service';
import { MolvModule } from '../../../shared/components/molv-module.component';
import { WindowComponent } from '../../../shared/components/window/window.component';
import { SwUpdate } from '@angular/service-worker';

@Component({
  selector: 'settings-window',
  imports: [CommonModule, WindowComponent, MolvModule, TranslocoPipe],
  templateUrl: './settings-window.component.html',
  styleUrl: './settings-window.component.css',
  standalone: true
})
export class SettingsWindowComponent {
  @Input() isVisible = false;
  @Output() closeWindow = new EventEmitter<void>();

  private updates = inject(SwUpdate, { optional: true });
  private uiState = inject(UiStateService);

  // LANGUAGE SETTINGS
  language: SupportedLangs = SupportedLangs.EN;

  // SW UPDATE
  updateAvailable = this.uiState.updateAvailable;

  // Expose enum to template
  supportedLangs = SupportedLangs;

  constructor(private langService: LanguageService) {
    this.language = this.uiState.getValue<SupportedLangs>('language') || this.langService.getLang();
  }

  onWindowClose() {
    this.closeWindow.emit();
  }

  // LANGUAGE SETTINGS
  onLangChange(lang: SupportedLangs) {
    this.language = lang;
    this.langService.setLang(lang);
    this.uiState.saveState({ language: lang });
  }

  // SW UPDATE 
  async updateApp() {
    if (!this.updates?.isEnabled) return;

    await this.updates.activateUpdate();
    this.uiState.clearUpdate();

    document.location.reload();
  }
}