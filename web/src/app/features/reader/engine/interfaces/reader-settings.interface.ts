/** All supported reading modes. */
export type ReadingMode = 'page' | 'horizontal' | 'dual' | 'scroll';

/**
 * Image fit strategy used by reader.
 */
export type FitMode = 'width' | 'height' | 'contain' | 'original';

/** Full extended settings model. Superset of legacy scroll/page settings. */
export interface ReaderSettings {
  mode: ReadingMode;
  zoom: number;
  gap: number;
  fitMode: FitMode;
  dualPageCover: boolean;
  reducedMotion: boolean;
}

/** A dual-page spread: left + right slots (one may be null for cover/odd page). */
export interface PagePair {
  left: { id: number; width?: number | null; height?: number | null } | null;
  right: { id: number; width?: number | null; height?: number | null } | null;
  /** Sequential index used as @for track key. */
  pairIndex: number;
}
