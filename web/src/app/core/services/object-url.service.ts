import { Injectable } from '@angular/core';
import { isIOS } from '../../shared/utils/constants';

@Injectable({ providedIn: 'root' })
export class ObjectUrlService {
  private cache = new Map<string, string>();

  async createUrl(key: string, src: Blob | string): Promise<string> {
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    let url: string;

    if (isIOS) {
      url = src as string;
    } else {
      url = URL.createObjectURL(src as Blob);
    }

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

  // convert Blob to Data URL
  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  }
}
