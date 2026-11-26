import { expect, it } from 'vitest';
import { parseEmbeds, resolveEmbed } from './embeds';

const entries = [
  { path: 'AI.md', name: 'AI.md', kind: 'note' },
  { path: 'Pasted image 20260916080253.png', name: 'Pasted image 20260916080253.png', kind: 'image' },
  { path: 'Journal/images/coastline.svg', name: 'coastline.svg', kind: 'image' },
  { path: 'Projects/assets/home.jpg', name: 'home.jpg', kind: 'image' },
  { path: 'Projects/assets/deep/home.jpg', name: 'home.jpg', kind: 'image' },
];

it('splits text around wikilink embeds and reads the optional size', () => {
  expect(parseEmbeds('plain text')).toEqual([{ text: 'plain text' }]);
  expect(parseEmbeds('![[a.png]]')).toEqual([{ embed: { target: 'a.png', size: null } }]);
  expect(parseEmbeds('![[Design assets/home.jpg|200]] and ![[b.png]]')).toEqual([
    { embed: { target: 'Design assets/home.jpg', size: 200 } },
    { text: ' and ' },
    { embed: { target: 'b.png', size: null } },
  ]);
  // Ordinary markdown images and links are not embeds.
  expect(parseEmbeds('![alt](x.png) and [[link]]')).toEqual([{ text: '![alt](x.png) and [[link]]' }]);
});

it('resolves embeds note-relative, vault-relative, and by unique name', () => {
  expect(resolveEmbed('Journal/Walk.md', 'images/coastline.svg', entries)).toBe('Journal/images/coastline.svg');
  expect(resolveEmbed('Journal/Walk.md', '../Projects/assets/home.jpg', entries)).toBe('Projects/assets/home.jpg');
  expect(resolveEmbed('AI.md', 'Pasted image 20260916080253.png', entries)).toBe('Pasted image 20260916080253.png');
  // A bare name found in several places resolves to the shortest path.
  expect(resolveEmbed('AI.md', 'home.jpg', entries)).toBe('Projects/assets/home.jpg');
  // Unknown targets still produce a guess so the preview can report them missing.
  expect(resolveEmbed('Journal/Walk.md', 'images/gone.png', entries)).toBe('Journal/images/gone.png');
  expect(resolveEmbed('AI.md', 'https://example.com/x.png', entries)).toBe('https://example.com/x.png');
});
