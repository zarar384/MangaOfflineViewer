export interface Page {
  id?: number;
  tabId: number;   // FK
  src:  Blob | string;
  name?: string;
  pageNumber?: number;
}
