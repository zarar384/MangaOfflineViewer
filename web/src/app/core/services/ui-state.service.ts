import { computed, Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class UiStateService {
  private storageKey = 'ui-state';

  // signal-trigger instead of Subject
  private refreshTabsSignal = signal(0);

  getState(): any {
    const state = localStorage.getItem(this.storageKey);
    return state ? JSON.parse(state) : {};
  }

  saveState(partialState: Partial<any>) {
    const currentState = this.getState();
    const newState = { ...currentState, ...partialState };
    localStorage.setItem(this.storageKey, JSON.stringify(newState));
  }

  getValue<T>(key: string): T | null {
    const state = this.getState();
    return state[key] ?? null;
  }

  // expose readonly signal
  refreshTabs = computed(() => this.refreshTabsSignal());

  triggerRefreshTabs() {
    this.refreshTabsSignal.update(v => v + 1);
  }
}
