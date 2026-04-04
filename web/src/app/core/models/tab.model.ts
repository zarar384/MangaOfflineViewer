import { ViewMod } from "../../shared/enums/viewmod.enum";

export type TabMode = ViewMod.Single | ViewMod.Chapters;

export interface Tab {
  id?: number;
  name: string;
  description?: string;
  preview?: Blob | string;
  updatedAt?: number;
  mode?: TabMode;
}
