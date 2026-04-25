import {SearchToken, SearchTokenType, SearchTagKey } from "../models/search-token.model";

export function parseQuery(query: string): SearchToken[] {
  return query
    .trim()
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map(token => {
      if (token.includes(':')) {
        const [key, value] = token.split(':');
        return { type: SearchTokenType.Tag, key: key as SearchTagKey, value };
      }

      return { type: SearchTokenType.Text, value: token };
    });
}