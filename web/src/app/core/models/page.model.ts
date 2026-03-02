export interface Page {
  id?: number;
  tabId: number;   // FK
  chapterId?: number; // FK, nullable
  src:  Blob | string;
  name?: string;
  pageNumber?: number;
}
