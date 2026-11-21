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

export type LinkTarget = { kind: 'external'; url: string } | {
  kind: 'local'; path: string; workspacePath: string | null; hash: string;
};

/** Classify clicked links separately from the stricter paths used to read vault contents. */
export function linkTarget(note: string, href: string): LinkTarget | null {
  href = href.trim();
  if (/[\u0000-\u001f\u007f]/.test(href)) return null;
  if (/^(https?:|mailto:|tel:)/i.test(href)) return { kind: 'external', url: href };
  if (href.startsWith('//')) return { kind: 'external', url: `https:${href}` };
  if (/^file:/i.test(href)) {
    try {
      const url = new URL(href);
      let path = decodeURIComponent(url.pathname);
      if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
      if (url.hostname && url.hostname !== 'localhost') path = `//${url.hostname}${path}`;
      if (/[\u0000-\u001f\u007f]/.test(path)) return null;
      return { kind: 'local', path, workspacePath: null, hash: url.hash.slice(1) };
    } catch { return null; }
  }
  const windowsPath = /^[a-z]:[\\/]/i.test(href);
  if (!windowsPath && /^[a-z][a-z\d+.-]*:/i.test(href)) return null;
  const hashAt = href.indexOf('#'), hash = hashAt < 0 ? '' : href.slice(hashAt + 1);
  const raw = (hashAt < 0 ? href : href.slice(0, hashAt)).split('?')[0];
  let decoded: string;
  try { decoded = decodeURIComponent(raw).replaceAll('\\', '/'); } catch { return null; }
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return null;
  const absolute = decoded.startsWith('/') || /^[a-z]:\//i.test(decoded);
  if (!absolute && /^[a-z][a-z\d+.-]*:/i.test(decoded)) return null;
  const local = localTarget(note, raw + (hash ? `#${hash}` : ''));
  const base = note.split('/').slice(0, -1).join('/');
  const path = !decoded ? note : absolute ? decoded : [base, decoded].filter(Boolean).join('/');
  return { kind: 'local', path: local?.path ?? path, workspacePath: local?.path ?? null, hash };
}
