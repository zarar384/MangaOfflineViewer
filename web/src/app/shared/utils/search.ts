import {
  SearchToken,
  SearchTokenType,
  SearchTagKey
} from "../models/search-token.model";

/*
  Search examples:

  artist:hideo_kojima
  artist:hayao_miyazaki tags:horror;action
  tags:psychological tokyo_ghoul
  tags:horror; action tokyo_ghoul

  Rules:
  * spaces split tokens
  * multi-word artist/tag values use _
  * tags are separated with ;
  * everything outside artist:/tags: is normal title search
*/

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
      // tags: horror; action
      else {

        index++;

        // collect tags until next search token
        while (index < parts.length) {

          const next =
            parts[index].toLowerCase();

          // stop at next tag key
          if (
            next.startsWith(`${SearchTagKey.Artist}:`) ||
            next.startsWith(`${SearchTagKey.Tags}:`)
          ) {
            break;
          }

          // stop if token does not belong to tags list
          if (
            rawValue &&
            !parts[index - 1].includes(';')
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