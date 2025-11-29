import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class UiStateService {
  private storageKey = 'ui-state';

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
}
