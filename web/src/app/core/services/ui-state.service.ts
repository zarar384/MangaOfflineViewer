import { computed, Injectable, signal } from '@angular/core';
import { ViewMod } from '../../shared/enums/viewmod.enum';

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

  // View mode
  private currentViewSignal = signal<ViewMod>(ViewMod.Home);
  private nextViewSignal = signal<ViewMod | null>(null);

  currentView = this.currentViewSignal.asReadonly();
  nextView = this.nextViewSignal.asReadonly();

  // Upload window
  private uploadWindowSignal = signal(false);

  // Selected manga
  private selectedMangaIdSignal = signal<number | null>(null);

  selectedMangaId = this.selectedMangaIdSignal.asReadonly();

  constructor() {
    const saved = this.getState();

    if (saved.openedChapters) {
      this.openedChaptersSignal.set(saved.openedChapters);
    }

    if (saved.readerState) {
      this.readerStateSignal.set(saved.readerState);
    }

    if (saved.viewMode) {
      this.currentViewSignal.set(saved.viewMode);
    }

    if (saved.selectedMangaId) {
      this.selectedMangaIdSignal.set(saved.selectedMangaId);
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

  // VIEW MODE
  async navigate(to: ViewMod) {
    const from = this.currentViewSignal();

    if (from === to) return;

    this.nextViewSignal.set(to);

    // Maybe add loading...
    // await new Promise(r => setTimeout(r, 300));

    this.currentViewSignal.set(to);
    this.nextViewSignal.set(null);

    this.saveState({ viewMode: to });
  }

  // UPLOAD WINDOW
  setUploadWindow(value: boolean) {
    this.uploadWindowSignal.set(value);
  }

  uploadWindow() {
    return this.uploadWindowSignal();
  }

  // SELECTED MANGA
  setSelectedManga(id: number | null) {
    this.selectedMangaIdSignal.set(id);
    this.saveState({ selectedMangaId: id });
  }
}