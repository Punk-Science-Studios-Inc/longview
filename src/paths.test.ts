import { describe, expect, it } from 'vitest';
import { localTarget, headingId } from './paths';
describe('workspace link resolution', () => {
  it('resolves sibling notes, parent folders, encoded spaces, and heading fragments', () => {
    expect(localTarget('Journal/Walk.md', '../Projects/Garden%20notes.md#seed-list')).toEqual({path:'Projects/Garden notes.md',hash:'seed-list'});
    expect(localTarget('Journal/Walk.md', '#ideas')).toEqual({path:'Journal/Walk.md',hash:'ideas'});
    expect(localTarget('Journal/Walk.md', 'images/coast.png')?.path).toBe('Journal/images/coast.png');
  });
  it('rejects workspace escape and external schemes including encoded paths', () => {
    for (const url of ['../../secret.md','https://example.com','javascript:alert(1)','file:///secret.md','//host/secret.md','%2Fsecret.md','%43%3A%5Csecret.md','..\\..\\secret.md','%zz']) {
      expect(localTarget('Journal/Walk.md',url),url).toBeNull();
    }
  });
  it('builds readable Unicode heading IDs', () => { expect(headingId('A quiet café!')).toBe('a-quiet-café'); });
});
