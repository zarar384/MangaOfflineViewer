export interface Page {
  id?: number;
  tabId: number;   // FK
  src:  Blob;
  name?: string;
  pageNumber?: number;
}
