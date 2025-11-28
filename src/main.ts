import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { isDevMode } from '@angular/core';
import { provideServiceWorker, SwUpdate } from '@angular/service-worker';

const providers = [];
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