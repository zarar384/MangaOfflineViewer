import { Injectable, computed, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class StorageInfoService {

  readonly usedBytes = signal(0);
  readonly totalBytes = signal(0);

  readonly usedPercent = computed(() => {
    const total = this.totalBytes();
    return total > 0 ? this.usedBytes() / total * 100 : 0;
  });

  readonly usedText = computed(() => this.formatBytes(this.usedBytes()));
  readonly totalText = computed(() => this.formatBytes(this.totalBytes()));

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (!('storage' in navigator) || !navigator.storage.estimate) {
      this.usedBytes.set(0);
      this.totalBytes.set(0);
      return;
    }

    const estimate = await navigator.storage.estimate();

    this.usedBytes.set(estimate.usage ?? 0);
    this.totalBytes.set(estimate.quota ?? 0);
  }

  private formatBytes(bytes: number): string {
    if (bytes <= 0) {
      return '0 GB';
    }

    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }
}