import { ViewMod } from '../enums/viewmod.enum';
import {
  MangaStructureChapterMetadata,
  MangaStructureMetadata,
  MangaStructureMetadataParseResult,
  MangaStructurePageMetadata,
  MANGA_STRUCTURE_METADATA_MARKER,
  MANGA_STRUCTURE_METADATA_VERSION
} from '../models/manga-structure-metadata';

export function parseMangaStructureMetadata(
  value: unknown,
  availableAssets: ReadonlySet<string>
): MangaStructureMetadataParseResult {
  // The marker identifies metadata created for Manga Offline Viewer.
  if (!isRecord(value) || value.marker !== MANGA_STRUCTURE_METADATA_MARKER) {
    return { error: 'Missing metadata marker.' };
  }

  // Each metadata version has its own parser so that changes to the format
  // do not break the interpretation of metadata created by older versions.
  switch (value.version) {
    case 1:
      return parseV1(value, availableAssets);

    // Add new metadata versions here.
    // For example:
    // case 2:
    //   return parseV2(value, availableAssets);

    default:
      return { error: `Unsupported metadata version: ${String(value.version)}.` };
  }
}

function parseV1(
  value: Record<string, unknown>,
  availableAssets: ReadonlySet<string>
): MangaStructureMetadataParseResult {
  if (value.mode === ViewMod.Single) {
    if (!Array.isArray(value.pages)) {
      return { error: 'Invalid single-manga page metadata.' };
    }

    const pages = parsePages(value.pages, availableAssets, new Set());

    return pages
      ? {
        metadata: {
          marker: MANGA_STRUCTURE_METADATA_MARKER,
          version: MANGA_STRUCTURE_METADATA_VERSION,
          mode: ViewMod.Single,
          pages
        }
      }
      : { error: 'Invalid single-manga page metadata.' };
  }

  if (
    value.mode !== ViewMod.Chapters
    || !Array.isArray(value.chapters)
    || value.chapters.length === 0
  ) {
    return { error: 'Invalid manga mode or chapters.' };
  }

  const usedAssets = new Set<string>();
  const chapters: MangaStructureChapterMetadata[] = [];

  for (const chapter of value.chapters) {
    if (
      !isRecord(chapter)
      || typeof chapter.title !== 'string'
      || !Array.isArray(chapter.pages)
    ) {
      return { error: 'Invalid chapter metadata.' };
    }

    const chapterPages = parsePages(
      chapter.pages,
      availableAssets,
      usedAssets
    );

    if (!chapterPages) {
      return { error: 'Invalid chapter page metadata.' };
    }

    chapters.push({
      title: chapter.title,
      pages: chapterPages
    });
  }

  return {
    metadata: {
      marker: MANGA_STRUCTURE_METADATA_MARKER,
      version: MANGA_STRUCTURE_METADATA_VERSION,
      mode: ViewMod.Chapters,
      chapters
    }
  };
}

function parsePages(
  value: unknown[],
  availableAssets: ReadonlySet<string>,
  usedAssets: Set<string>
): MangaStructurePageMetadata[] | null {
  const pages: MangaStructurePageMetadata[] = [];

  for (const page of value) {
    // An asset may belong to only one imported page.
    if (
      !isRecord(page)
      || typeof page.asset !== 'string'
      || !page.asset
      || !availableAssets.has(page.asset)
      || usedAssets.has(page.asset)
    ) {
      return null;
    }

    usedAssets.add(page.asset);
    pages.push({ asset: page.asset });
  }

  return pages;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}