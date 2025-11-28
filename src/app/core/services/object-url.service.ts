import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ObjectUrlService {
  private cache = new Map<string, string>();

  createUrl(key: string, blob: Blob): string {
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }
    const url = URL.createObjectURL(blob);
    this.cache.set(key, url);
    return url;
  }

  revokeUrl(key: string) {
    const url = this.cache.get(key);
    if (url) {
      URL.revokeObjectURL(url);
      this.cache.delete(key);
    }
  }

  revokeAll() {
    this.cache.forEach(url => URL.revokeObjectURL(url));
    this.cache.clear();
  }
}
