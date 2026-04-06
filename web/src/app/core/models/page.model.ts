export interface Page {
  id?: number;
  tabId: number;   // FK
  chapterId?: number | null; // FK, nullable
  chapterOrder?: number | null;
  src:  Blob | string | null;
  name?: string;
  pageNumber?: number;
}
