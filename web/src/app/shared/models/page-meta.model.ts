export interface PageMeta {
  id?: number;
  tabId: number;   // FK
  chapterId?: number | null; // FK, nullable
  name?: string;
  pageNumber?: number;
}
