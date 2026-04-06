import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LoadingService {

  private loading = signal(false);

  readonly isLoading = this.loading.asReadonly();

show() {
  this.loading.set(true);
  document.body.classList.add('loading');
}

hide() {
  this.loading.set(false);
  document.body.classList.remove('loading');
}
}
