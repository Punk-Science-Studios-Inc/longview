import { localTarget } from './paths';

export interface EmbedPart {
  text?: string;
  embed?: { target: string; size: number | null };
}

/** Split text into plain runs and Obsidian-style `![[target]]` / `![[target|width]]` embeds. */
export function parseEmbeds(text: string): EmbedPart[] {
  const parts: EmbedPart[] = [];
  const pattern = /!\[\[([^\]]+)\]\]/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    const inner = match[1];
    const bar = inner.indexOf('|');
    const target = (bar < 0 ? inner : inner.slice(0, bar)).trim();
    const sizeText = bar < 0 ? '' : inner.slice(bar + 1).trim();
    parts.push({ embed: { target, size: /^\d+$/.test(sizeText) ? parseInt(sizeText, 10) : null } });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/**
 * Resolve an embed target to a workspace-relative path: note-relative first,
 * then vault-root-relative, then a unique (or shortest) name match anywhere.
 * Falls back to the raw target so a missing file is reported, not silently dropped.
 */
export function resolveEmbed(
  note: string,
  target: string,
  entries: readonly { path: string; name: string; kind: string }[],
): string {
  let raw = target;
  try { raw = decodeURIComponent(raw); } catch { /* keep the raw target */ }
  raw = raw.replaceAll('\\', '/').replace(/^\.\//, '');
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith('/')) return raw;
  const relative = localTarget(note, raw)?.path;
  const isImage = (path: string) => entries.some(e => e.path === path && e.kind === 'image');
  if (relative && isImage(relative)) return relative;
  if (isImage(raw)) return raw;
  const lower = raw.toLowerCase();
  const matches = entries.filter(
    e => e.kind === 'image'
      && (e.path.toLowerCase() === lower || e.path.toLowerCase().endsWith('/' + lower) || e.name.toLowerCase() === lower),
  );
  if (matches.length) return matches.sort((a, b) => a.path.length - b.path.length)[0].path;
  return relative || raw;
}
