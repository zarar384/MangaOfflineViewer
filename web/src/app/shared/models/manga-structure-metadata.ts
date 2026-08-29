import { ViewMod } from '../enums/viewmod.enum';

// Identifies metadata created for Manga Offline Viewer.
export const MANGA_STRUCTURE_METADATA_MARKER = 'molv-manga-structure';

// Current metadata format version used by the exporter.
// Increment this when the metadata structure changes.
export const MANGA_STRUCTURE_METADATA_VERSION = 1;

export interface MangaStructurePageMetadata {
  // References the image file stored in the exported archive/container.
  asset: string;
}

export interface MangaStructureChapterMetadata {
  // Chapter title restored during import.
  title: string;

  // Pages are stored in their intended reading order.
  pages: MangaStructurePageMetadata[];
}

interface MangaStructureMetadataBase {
  // Identifies this JSON as Manga Offline Viewer manga structure metadata.
  marker: typeof MANGA_STRUCTURE_METADATA_MARKER;

  // Identifies the metadata format version.
  // When the format changes, add a new version-specific parser in the metadata parser
  // and keep older parsers if older exported files must remain importable.
  version: typeof MANGA_STRUCTURE_METADATA_VERSION;
}

export interface SingleMangaStructureMetadata extends MangaStructureMetadataBase {
  mode: ViewMod.Single;

  // Pages are stored in their intended reading order.
  pages: MangaStructurePageMetadata[];
}

export interface ChaptersMangaStructureMetadata extends MangaStructureMetadataBase {
  mode: ViewMod.Chapters;

  // Chapters are stored in their intended order.
  chapters: MangaStructureChapterMetadata[];
}

export type MangaStructureMetadata =
  | SingleMangaStructureMetadata
  | ChaptersMangaStructureMetadata;

export type MangaStructureMetadataParseResult = {
  metadata?: MangaStructureMetadata;
  error?: string;
};