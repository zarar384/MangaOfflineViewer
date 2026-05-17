import { Injectable, signal, computed, inject } from '@angular/core';
import { UiStateService } from '../../../core/services/ui-state.service';
import { DeviceCapabilitiesService } from './device-capabilities.service';
import { FitMode, ReadingMode } from './interfaces/reader-settings.interface';

/**
 * Stores reader UI settings and persists them in ui state.
 */
@Injectable({ providedIn: 'root' })
export class SettingsStoreService {
  private readonly uiState = inject(UiStateService);
  private readonly device = inject(DeviceCapabilitiesService);

  /** How page image should fit inside the viewport. */
  readonly fitMode = signal<FitMode>(
    this.load<FitMode>('readerFitMode', 'height')
  );

  /** Whether first page is shown as cover in dual mode. */
  readonly dualPageCover = signal<boolean>(
    this.load<boolean>('readerDualPageCover', true)
  );

  /** Reduced motion preference used by reader UI. */
  readonly reducedMotion = signal<boolean>(
    this.load<boolean>('readerReducedMotion', false)
  );

  /**
   * Dual mode is disabled on portrait mobile because width is too small.
   */
  isDualPageActiveForMode(mode: ReadingMode): boolean {
    if (mode !== 'dual') return false;
    if (this.device.isMobile() && this.device.isPortrait()) return false;
    return true;
  }

  setFitMode(fit: FitMode): void {
    this.fitMode.set(fit);
    this.uiState.saveState({ readerFitMode: fit });
  }

  setDualPageCover(val: boolean): void {
    this.dualPageCover.set(val);
    this.uiState.saveState({ readerDualPageCover: val });
  }

  setReducedMotion(val: boolean): void {
    this.reducedMotion.set(val);
    this.uiState.saveState({ readerReducedMotion: val });
  }

  private load<T>(key: string, defaultValue: T): T {
    return this.uiState.getValue<T>(key) ?? defaultValue;
  }
}
