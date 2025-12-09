import { Injectable } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  constructor(private transloco: TranslocoService) {}

  init() {
    const saved = localStorage.getItem('lang') || 'en';
    this.transloco.setActiveLang(saved);
  }

  setLang(lang: 'en' | 'cs' | 'ru') {
    this.transloco.setActiveLang(lang);
    localStorage.setItem('lang', lang);
  }

  getLang() {
    return this.transloco.getActiveLang();
  }
}
