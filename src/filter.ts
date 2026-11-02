export function tagMatches(tags: readonly string[], selected: string): boolean {
  const target = selected.replace(/^#/, '').toLowerCase();
  return tags.some(tag => { const value = tag.replace(/^#/, '').toLowerCase(); return value === target || value.startsWith(target + '/'); });
}

export function fileMatches(entry: {kind: string; path: string; title?: string | null; tags: string[]}, query: string, tag: string): boolean {
  if (tag && (entry.kind !== 'note' || !tagMatches(entry.tags, tag))) return false;
  return !query || `${entry.path} ${entry.title || ''} ${entry.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase());
}
