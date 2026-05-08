import {
  SearchToken,
  SearchTokenType,
  SearchTagKey
} from "../models/search-token.model";

export function parseQuery(query: string): SearchToken[] {

  const result: SearchToken[] = [];

  const parts = query
    .trim()
    .split(/\s+/);

  let index = 0;

  while (index < parts.length) {

    const rawPart = parts[index];

    const part = rawPart.toLowerCase();

    // artist:
    if (
      part === `${SearchTagKey.Artist}:` ||
      part.startsWith(`${SearchTagKey.Artist}:`)
    ) {

      let rawValue = '';

      // artist:hideo_kojima
      if (part !== `${SearchTagKey.Artist}:`) {

        rawValue =
          rawPart.slice(
            `${SearchTagKey.Artist}:`.length
          );
      }
      // artist: hideo_kojima
      else {

        index++;

        rawValue = parts[index] ?? '';
      }

      const value =
        rawValue
          .replace(/_/g, ' ')
          .replace(/;/g, '')
          .trim()
          .toLowerCase();

      if (value) {

        result.push({
          type: SearchTokenType.Tag,
          key: SearchTagKey.Artist,
          value
        });
      }

      index++;

      continue;
    }

    // tags:
    if (
      part === `${SearchTagKey.Tags}:` ||
      part.startsWith(`${SearchTagKey.Tags}:`)
    ) {

      let rawValue = '';

      // tags:horror;action
      if (part !== `${SearchTagKey.Tags}:`) {

        rawValue =
          rawPart.slice(
            `${SearchTagKey.Tags}:`.length
          );
      }
      // tags: horror;action
      else {

        index++;

        // collect until next tag
        while (index < parts.length) {

          const next =
            parts[index].toLowerCase();

          if (
            next.startsWith(`${SearchTagKey.Artist}:`) ||
            next.startsWith(`${SearchTagKey.Tags}:`)
          ) {
            break;
          }

          rawValue +=
            (rawValue ? ' ' : '') +
            parts[index];

          index++;
        }
      }

      const values =
        rawValue
          .split(';')
          .map(v =>
            v
              .replace(/_/g, ' ')
              .trim()
              .toLowerCase()
          )
          .filter(Boolean);

      for (const value of values) {

        result.push({
          type: SearchTokenType.Tag,
          key: SearchTagKey.Tags,
          value
        });
      }

      continue;
    }

    // normal text token
    result.push({
      type: SearchTokenType.Text,
      value: part.toLowerCase()
    });

    index++;
  }

  return result;
}