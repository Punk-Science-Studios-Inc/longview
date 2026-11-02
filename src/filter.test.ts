import { expect, it } from 'vitest';
import { fileMatches, tagMatches } from './filter';
it('matches tags case-insensitively and includes descendants, not similar prefixes', () => {
  expect(tagMatches(['Work/design'], '#WORK')).toBe(true);
  expect(tagMatches(['workshop'], 'work')).toBe(false);
  expect(tagMatches(['home/work'], 'work')).toBe(false);
});
it('combines text and tag filters and excludes images from tag results', () => {
  const note = {kind:'note',path:'Ideas/nostr.md',title:'Get on Nostr',tags:['idea','nostr']};
  expect(fileMatches(note, 'get on', 'idea')).toBe(true);
  expect(fileMatches(note, 'other', 'idea')).toBe(false);
  expect(fileMatches({...note,kind:'image'}, '', 'idea')).toBe(false);
  expect(fileMatches(note, '', 'web')).toBe(false);
});
