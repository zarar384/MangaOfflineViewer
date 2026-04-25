import { PageMeta } from "src/app/shared/models/page-meta.model";

export interface Page extends PageMeta {
  src?:  Blob | string | null;
  chapterOrder?: number | null;
}