export interface Bookmark {
  id?: number;
  tabId: number;        
  pageId: number;       
  chapterId?: number | null;
  createdAt: number;
  title?: string;      
}
