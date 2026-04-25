export enum SearchTokenType {
  Text = 'text',
  Tag = 'tag'
}

export enum SearchTagKey {
  Artist = 'artist',
  Genre = 'genre'
}

export type SearchToken = {
  type: SearchTokenType;
  key?: SearchTagKey;
  value: string;
};