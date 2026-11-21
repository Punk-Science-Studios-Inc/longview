import { describe, expect, it } from 'vitest';
import { localTarget, headingId, linkTarget } from './paths';
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

describe('clickable link targets', () => {
  it('opens web, email, telephone, and protocol-relative links externally', () => {
    for (const href of ['https://example.com/a#b', 'HTTP://example.com', 'mailto:hi@example.com', 'tel:+15551234']) {
      expect(linkTarget('Journal/Walk.md', href)).toEqual({kind: 'external', url: href});
    }
    expect(linkTarget('Journal/Walk.md', '//example.com/page')).toEqual({kind: 'external', url: 'https://example.com/page'});
  });
  it('resolves local notes, attachments, folders, and encoded filename punctuation', () => {
    expect(linkTarget('Journal/Walk.md', '../Projects/Garden%20notes.md?view=1#ideas')).toEqual({kind:'local', path:'Projects/Garden notes.md', workspacePath:'Projects/Garden notes.md', hash:'ideas'});
    expect(linkTarget('Journal/Walk.md', '../')).toEqual({kind:'local', path:'', workspacePath:'', hash:''});
    expect(linkTarget('Journal/Walk.md', 'files/report%231%3F.pdf')).toEqual({kind:'local', path:'Journal/files/report#1?.pdf', workspacePath:'Journal/files/report#1?.pdf', hash:''});
    expect(linkTarget('Journal/Walk.md', '#ideas')).toEqual({kind:'local', path:'Journal/Walk.md', workspacePath:'Journal/Walk.md', hash:'ideas'});
  });
  it('allows explorer-only links outside the vault without granting note access', () => {
    expect(linkTarget('Journal/Walk.md', '../../outside.pdf')).toEqual({kind:'local', path:'Journal/../../outside.pdf', workspacePath:null, hash:''});
    expect(linkTarget('Journal/Walk.md', '/home/user/My%20files')).toEqual({kind:'local', path:'/home/user/My files', workspacePath:null, hash:''});
    expect(linkTarget('Journal/Walk.md', 'file:///home/user/My%20files/report%23.pdf')).toEqual({kind:'local', path:'/home/user/My files/report#.pdf', workspacePath:null, hash:''});
    expect(linkTarget('Journal/Walk.md', 'file:///C:/My%20files/note.md')).toEqual({kind:'local', path:'C:/My files/note.md', workspacePath:null, hash:''});
    expect(linkTarget('Journal/Walk.md', 'C:\\My%20files\\note.md')).toEqual({kind:'local', path:'C:/My files/note.md', workspacePath:null, hash:''});
  });
  it('rejects executable schemes and malformed/control-character links', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,<script>', 'vbscript:run', 'javascript%3Aalert(1)', 'file://%zz', 'note%00.md', 'file:///tmp/%00', 'note%zz.md', 'java\nscript:alert(1)']) {
      expect(linkTarget('Journal/Walk.md', href), href).toBeNull();
    }
  });
});
