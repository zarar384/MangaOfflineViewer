export interface Page {
  id?: number;
  tab: number;   // FK
  src:  Blob;
  name?: string;
}
