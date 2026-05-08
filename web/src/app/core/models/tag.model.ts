export interface Tag {
  id?: number;
  name: string;
  normalized: string; // lowercase and trimmed version of name for easier searching
  createdAt: number;
}