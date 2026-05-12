export interface PageMeta {
  id?: number;
  name?: string;
  order?: number;

  width?: number | null;
  height?: number | null;
  
  tabId: number;   // FK
  chapterId?: number | null; // FK, nullable

  chapterOrder?: number | null;
}
