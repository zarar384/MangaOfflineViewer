import { computed, Injectable, signal } from '@angular/core';

interface ReaderState {
  tabId: number;
  chapterId: number;
  page: number;
}

@Injectable({ providedIn: 'root' })
export class UiStateService {
  private storageKey = 'ui-state';

  private refreshTabsSignal = signal(0);

  // signals
  private editModeSignal = signal<boolean>(false);
  editMode = this.editModeSignal.asReadonly();

  private openedChaptersSignal = signal<number[]>([]);
  openedChapters = this.openedChaptersSignal.asReadonly();

  private readerStateSignal = signal<ReaderState | null>(null);
  readerState = this.readerStateSignal.asReadonly();

  constructor() {
    const saved = this.getState();

    if (saved.openedChapters) {
      this.openedChaptersSignal.set(saved.openedChapters);
    }

    if (saved.readerState) {
      this.readerStateSignal.set(saved.readerState);
    }
  }

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

  // EDIT MODE
  setEditMode(value: boolean) {
    this.editModeSignal.set(value);
  }

  // CHAPTER TOGGLE
  toggleChapter(id: number) {
    const current = this.openedChaptersSignal();
    const exists = current.includes(id);

    const updated = exists
      ? current.filter(c => c !== id)
      : [...current, id];

    this.openedChaptersSignal.set(updated);
    this.saveState({ openedChapters: updated });
  }

  isChapterOpen(id: number): boolean {
    return this.openedChaptersSignal().includes(id);
  }

  // READER STATE
  openReader(state: ReaderState) {
    this.readerStateSignal.set(state);
    this.saveState({ readerState: state });
  }

  // TABS REFRESH
  refreshTabs = computed(() => this.refreshTabsSignal());

  triggerRefreshTabs() {
    this.refreshTabsSignal.update(v => v + 1);
  }
}