export interface Page {
  id?: number;
  tabId: number;   // FK
  chapterId?: number | null; // FK, nullable
  chapterOrder?: number | null;
  src:  Blob | string;
  name?: string;
  pageNumber?: number;
}
