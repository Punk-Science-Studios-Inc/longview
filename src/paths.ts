/** Resolve document-relative links using portable workspace-relative paths. */
export function localTarget(note: string, href: string): { path: string; hash: string } | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('/')) return null;
  const hashAt = href.indexOf('#');
  let raw = hashAt < 0 ? href : href.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : href.slice(hashAt + 1);
  if (!raw) return { path: note, hash };
  try { raw = decodeURIComponent(raw); } catch { return null; }
  // Backslashes are separators on Windows too. Reject encoded absolute paths.
  raw = raw.replaceAll('\\', '/');
  if (raw.startsWith('/') || /^[a-z]:/i.test(raw)) return null;
  const parts = note.split('/').slice(0, -1);
  for (const part of raw.split('/')) {
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  return { path: parts.join('/'), hash };
}

export function headingId(text: string): string {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
}
