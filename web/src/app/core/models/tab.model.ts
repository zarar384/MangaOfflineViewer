export interface Tab {
  id?: number;
  name: string;
  description?: string;
  preview?: Blob | string;
  updatedAt?: number;
}
