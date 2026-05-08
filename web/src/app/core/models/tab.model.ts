import { ViewMod } from "../../shared/enums/viewmod.enum";

export type TabMode = ViewMod.Single | ViewMod.Chapters;

export interface Tab {
  id?: number;

  name: string;
  description?: string;
  preview?: Blob | string;

  artistIds?: number[];
  tagIds?: number[];

  updatedAt?: number;
  createdAt?: number;

  mode?: TabMode;
}
