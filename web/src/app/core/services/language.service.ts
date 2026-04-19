import { Injectable } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { UiStateService } from './ui-state.service';
 
export enum SupportedLangs {
  EN = 'en',
  CS = 'cs',
  RU = 'ru',
  ES = 'es'
}

@Injectable({ providedIn: 'root' })
export class LanguageService {
  constructor(private transloco: TranslocoService, private uiState: UiStateService) {}

  init() {
    const saved = this.uiState.getValue<SupportedLangs>('language') || SupportedLangs.EN;
    this.transloco.setActiveLang(saved);
  }

  setLang(lang: SupportedLangs) {
    if(!lang){
      lang = SupportedLangs.EN;
    }
    this.transloco.setActiveLang(lang);
    this.uiState.saveState({ language: lang });
  }

  getLang(): SupportedLangs {
    return this.transloco.getActiveLang() as SupportedLangs;
  }

  translate(key: string): string {
    return this.transloco.translate(key);
  }
}
