import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { inject, isDevMode, provideAppInitializer } from '@angular/core';
import { provideServiceWorker, SwUpdate } from '@angular/service-worker';
import { provideHttpClient } from '@angular/common/http';

import { provideTransloco } from '@jsverse/transloco';
import { TranslocoLoaderService } from './app/core/services/transloco-loader.service';
import { LanguageService } from './app/core/services/language.service';

const providers = [
  provideHttpClient(), // to load assets/i18n JSON files

  provideTransloco({
    config: {
      availableLangs: ['en', 'cs', 'ru'],
      defaultLang: 'en',
      fallbackLang: 'en',
      reRenderOnLangChange: true,
      prodMode: !isDevMode()
    },
    loader: TranslocoLoaderService
  }),
  
  provideAppInitializer(() => {
    const langService = inject(LanguageService);
    langService.init();
  })
];

if (!isDevMode()) {
  providers.push(
    provideServiceWorker('ngsw-worker.js', {
      enabled: true,
      registrationStrategy: 'registerWhenStable:30000'
    })
  );
}

bootstrapApplication(AppComponent, {
  providers
}).then(appRef => {
  const updates = appRef.injector.get(SwUpdate);
  updates.unrecoverable.subscribe(() => {
    // ignore errors for now
  });
});
