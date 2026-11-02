import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { localTarget, headingId } from './paths';
import { fileMatches } from './filter';
import './style.css';

interface Entry { path: string; name: string; kind: 'folder' | 'note' | 'image'; tags: string[]; title: string | null }
interface NoteMetadata { properties: Record<string, unknown>; tags: string[]; error: string | null }
interface ParsedNote { body: string; metadata: NoteMetadata }
interface Folder { name: string; entries: Entry[] }
interface Opened { folder: Folder; file: string | null }
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let folder: Folder | null = null, path = '', original = '', text = '', editMode = false;
let folderMode = false;
let activeTag = '';
let contextEntry: Entry | null = null, deletingEntry: Entry | null = null;
const trashName = navigator.platform.startsWith('Win') ? 'Recycle Bin' : 'Trash';
let busy = false, saving = false, generation = 0, editTimer: ReturnType<typeof setTimeout>;
const editorStates = new Map<string, EditorState>();
const closedFolders = new Set<string>();
let afterLeave: (() => Promise<void>) | null = null;
const dirty = () => text !== original;
const native = isTauri();

const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: '#332e26', fontSize: '14px' },
  '.cm-scroller': { fontFamily: 'ui-monospace, Consolas, monospace', lineHeight: '1.85', overflow: 'auto' },
  '.cm-content': { padding: '26px 0 90px', maxWidth: '720px', margin: '0 auto', width: '100%' },
  '.cm-line': { padding: '0 40px' }, '.cm-gutters': { display: 'none' },
  '.cm-activeLine': { backgroundColor: '#ebe4d144' },
  '.cm-cursor': { borderLeftColor: '#586343' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#d8d9b9' },
});
const extensions = [basicSetup, markdown(), EditorView.lineWrapping, editorTheme,
  keymap.of([{ key: 'Mod-s', run: () => { void save(); return true; } }]),
  EditorView.updateListener.of(update => {
    if (!update.docChanged) return;
    text = update.state.sliceDoc(); updateStatus();
    clearTimeout(editTimer); editTimer = setTimeout(() => { void renderNote(); }, 250);
  }),
];
const editor = new EditorView({ state: EditorState.create({ extensions }), parent: el('editor') });
function noteState(contents: string) {
  return EditorState.create({doc: contents, extensions: [...extensions, EditorState.lineSeparator.of(contents.includes('\r\n') ? '\r\n' : '\n')]});
}

function notice(message: unknown) { el('notice').hidden = false; el('notice').querySelector('span')!.textContent = String(message); }
function clearNotice() { el('notice').hidden = true; }
function updateStatus() {
  el<HTMLButtonElement>('save').disabled = !path || !dirty() || saving;
  el('status').textContent = saving ? 'Saving…' : path ? dirty() ? 'Unsaved changes' : 'Saved to disk' : 'Ready when you are.';
  el('words').textContent = path ? `${text.trim().split(/\s+/).filter(Boolean).length} words` : '';
  el('filename').textContent = path ? `${path.split('/').pop()}${dirty() ? ' •' : ''}` : folder ? 'Choose a note' : 'No folder open';
  document.title = `${path ? path.split('/').pop() + (dirty() ? ' •' : '') + ' — ' : ''}Longview`;
  el<HTMLButtonElement>('edit').disabled = !path;
  el<HTMLButtonElement>('read').disabled = !path;
}
async function save(): Promise<boolean> {
  if (!path || !dirty()) return true;
  if (saving) return false;
  saving = true; const savedText = text; updateStatus(); clearNotice();
  try { await invoke('save_note', { path, text: savedText, expected: original }); original = savedText; return true; }
  catch (e) { notice(e); return false; }
  finally { saving = false; updateStatus(); }
}
async function mayLeave(action: () => Promise<void>) {
  if (saving || busy || afterLeave) return;
  if (dirty()) { afterLeave = action; el('unsaved-description').textContent = `${path.split('/').pop()} has unsaved changes.`; el<HTMLDialogElement>('unsaved').showModal(); }
  else await action();
}
function setMode(edit: boolean) {
  editMode = edit; el('editor').hidden = !edit || !path; el('preview').hidden = edit || !path;
  el('read').setAttribute('aria-pressed', String(!edit)); el('edit').setAttribute('aria-pressed', String(edit));
  if (edit) { editor.requestMeasure(); editor.focus(); } else void renderNote();
}
function togglePane(id: string, control: string, show = el(id).hidden) {
  el(id).hidden = !show; el(control).setAttribute('aria-expanded', String(show));
}

async function applyOpened(opened: Opened) {
  folder = opened.folder; folderMode = opened.file === null;
  path = ''; text = original = ''; generation++; editorStates.clear(); closedFolders.clear(); clearNotice();
  el<HTMLInputElement>('filter').value = '';
  activeTag = ''; document.querySelector('.workspace')!.classList.remove('tag-filtering');
  document.querySelector('.workspace')!.classList.toggle('folder-mode', folderMode);
  el('workspace-name').textContent = folder.name; el('tree-heading').textContent = folder.name.toUpperCase();
  el('breadcrumbs').textContent = folder.name;
  renderTree(); updateStatus(); await renderNote();
  togglePane('files-pane', 'files', folderMode);
  const next = opened.file ?? folder.entries.find(e => e.kind === 'note')?.path;
  if (next) await loadNote(next, '', false);
  else {
    el('empty').hidden = false; el('empty').querySelector('h1')!.textContent = 'A little room to grow.';
    el('empty').querySelector('p:not(.eyebrow)')!.textContent = 'This folder has no Markdown files. Add a .md file, then Refresh.';
  }
}
async function chooseTarget(kind: 'file' | 'folder') {
  if (!native) { notice('Run npm run tauri dev to open real folders in the desktop app.'); return; }
  await mayLeave(async () => {
    busy = true;
    try {
      const chosen = await invoke<Opened | null>(kind === 'file' ? 'open_file' : 'open_folder');
      if (!chosen) return;
      await applyOpened(chosen);
    } catch (e) { notice(e); } finally { busy = false; }
  });
}
async function loadNote(next: string, hash = '', remember = true) {
  const token = ++generation;
  try {
    const contents = await invoke<string>('read_note', { path: next, remember });
    if (token !== generation) return;
    if (path) editorStates.set(path, editor.state);
    path = next; original = contents;
    // A clean cached editor preserves undo/selection only while its disk contents agree.
    const cached = editorStates.get(path);
    editor.setState(cached?.sliceDoc() === contents ? cached : noteState(contents));
    text = editor.state.sliceDoc(); clearNotice();
    el('breadcrumbs').textContent = `${folder?.name} / ${path.split('/').join(' / ')}`;
    el('empty').hidden = true; setMode(editMode); updateStatus(); renderTree();
    if (!folderMode && !activeTag) togglePane('files-pane', 'files', false);
    await renderNote();
    if (hash) jumpToHeading(hash); else el('preview').scrollTop = 0;
  } catch (e) { notice(e); }
}
function navigate(next: string, hash = '') {
  if (busy || saving) return;
  if (next === path) {
    // An explicit open of the automatically previewed note must replace the saved folder,
    // while retaining any unsaved editor contents.
    void invoke('read_note', { path: next, remember: true }).catch(notice);
    if (hash) { setMode(false); jumpToHeading(hash); }
    return;
  }
  void mayLeave(async () => { busy = true; try { await loadNote(next, hash); } finally { busy = false; } });
}
function jumpToHeading(hash: string) {
  let id = hash; try { id = decodeURIComponent(hash); } catch { /* literal fragment */ }
  const target = [...el('preview').querySelectorAll('[id]')].find(h => h.id === id);
  target?.scrollIntoView({ block: 'start' });
}
function makeFile(entry: Entry, includePath = false) {
  const button = document.createElement('button'); button.className = `file ${entry.path === path ? 'active' : ''}`;
  const icon = document.createElement('span'); icon.textContent = entry.kind === 'image' ? '▧' : '▤'; icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span'); label.textContent = includePath ? entry.path : entry.name;
  button.append(icon, label); button.title = entry.path;
  if (entry.path === path) button.setAttribute('aria-current', 'page');
  button.onclick = () => { el<HTMLDialogElement>('finder').close(); if (entry.kind === 'note') navigate(entry.path); else void inspectImage(entry.path, entry.name); };
  if(!includePath) {
    button.oncontextmenu = event => { event.preventDefault(); openFileMenu(entry, button, event.clientX, event.clientY); };
    button.onkeydown = event => {
      if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); openFileMenu(entry, button); }
    };
  }
  return button;
}
function tagButton(tag: string, label = `#${tag}`) {
  const button = document.createElement('button'); button.className = 'tag'; button.textContent = label;
  button.setAttribute('aria-label', `Filter files by tag ${tag}`); button.onclick = () => selectTag(tag);
  return button;
}
function selectTag(tag: string) {
  activeTag = tag; document.querySelector('.workspace')!.classList.toggle('tag-filtering', !!tag);
  togglePane('files-pane', 'files', true); renderTree();
}
function renderTagIndex() {
  const active = el('active-tag'); active.hidden = !activeTag; active.replaceChildren();
  if(activeTag) { const clear = document.createElement('button'); clear.className = 'tag selected'; clear.textContent = `#${activeTag} ×`; clear.setAttribute('aria-label', `Clear tag filter ${activeTag}`); clear.onclick = () => selectTag(''); active.append(clear); }
  const counts = new Map<string, number>();
  for(const entry of folder?.entries || []) {
    if(entry.kind !== 'note') continue;
    const parents = new Set<string>();
    for(const tag of entry.tags) { const parts = tag.split('/'); for(let i = 1; i <= parts.length; i++) parents.add(parts.slice(0,i).join('/')); }
    for(const tag of parents) counts.set(tag,(counts.get(tag) || 0) + 1);
  }
  const catalog = el('tags-catalog'); catalog.replaceChildren();
  for(const tag of [...counts.keys()].sort()) {
    catalog.append(tagButton(tag,`#${tag} · ${counts.get(tag)}`));
  }
  el('tags-index').hidden = counts.size === 0;
}
function renderTree() {
  const tree = el('tree'); tree.replaceChildren(); if (!folder) return;
  renderTagIndex();
  const q = el<HTMLInputElement>('filter').value.trim().toLowerCase();
  const leaves = folder.entries.filter(e => e.kind !== 'folder' && fileMatches(e,q,activeTag));
  const visiblePaths = new Set(leaves.map(e => e.path));
  const needed = new Set<string>();
  for (const entry of leaves) { const parts = entry.path.split('/'); parts.pop(); while(parts.length) { needed.add(parts.join('/')); parts.pop(); } }
  const children = new Map<string, Entry[]>();
  for(const entry of folder.entries) {
    if(entry.kind === 'folder' ? !needed.has(entry.path) : !visiblePaths.has(entry.path)) continue;
    const parent = entry.path.split('/').slice(0,-1).join('/');
    const siblings = children.get(parent) || []; siblings.push(entry); children.set(parent,siblings);
  }
  function branch(parent: string, container: HTMLElement) {
    const entries = children.get(parent) || [];
    entries.sort((a,b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.kind !== 'folder') { container.append(makeFile(entry)); continue; }
      const details = document.createElement('details'); details.open = q !== '' || !!activeTag || !closedFolders.has(entry.path);
      const summary = document.createElement('summary'); summary.textContent = entry.name; details.append(summary);
      details.ontoggle = () => { if (details.open) closedFolders.delete(entry.path); else closedFolders.add(entry.path); };
      branch(entry.path, details); container.append(details);
    }
  }
  branch('', tree);
  if (!leaves.length) tree.textContent = q || activeTag ? 'No matching files. Clear the tag or text filter to see more.' : 'No notes or images in this folder.';
  const total = folder.entries.filter(e => e.kind === 'note').length, shown = leaves.filter(e => e.kind === 'note').length;
  el('file-count').textContent = q || activeTag ? `${shown} of ${total} notes` : `${total} notes`;
}

async function renderNote() {
  const preview = el('preview');
  if (!path) { preview.hidden = true; el('editor').hidden = true; return; }
  const activePath = path, activeText = text;
  const parsed = await invoke<ParsedNote>('parse_note', {text: activeText}).catch(error => { notice(error); return null; });
  if (!parsed || path !== activePath || text !== activeText) return;
  const entry = folder?.entries.find(e => e.path === path);
  const title = typeof parsed.metadata.properties.title === 'string' ? parsed.metadata.properties.title : null;
  if(entry && (JSON.stringify(entry.tags) !== JSON.stringify(parsed.metadata.tags) || entry.title !== title)) {
    entry.tags = parsed.metadata.tags; entry.title = title; renderTree();
  }
  // Strip document-controlled style, scripts, frames, forms, IDs, and local file URLs.
  preview.innerHTML = DOMPurify.sanitize(marked.parse(parsed.body, { async: false }), {
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'button', 'textarea', 'video', 'audio'],
    FORBID_ATTR: ['style', 'id', 'name', 'srcset', 'target'],
  });
  if(title && !preview.querySelector('h1')) { const heading = document.createElement('h1'); heading.textContent = title; preview.prepend(heading); }
  const properties = document.createElement('div'); properties.className = 'note-properties';
  for(const key of ['date','status']) {
    const value = parsed.metadata.properties[key];
    if(typeof value === 'string' || typeof value === 'number') { const item = document.createElement('span'); item.textContent = `${key}: ${value}`; properties.append(item); }
  }
  const tags = document.createElement('div'); tags.className = 'note-tags'; parsed.metadata.tags.forEach(tag => tags.append(tagButton(tag))); properties.append(tags);
  if(properties.textContent) { const h1 = preview.querySelector('h1'); if(h1)h1.after(properties); else preview.prepend(properties); }
  if(parsed.metadata.error) { const error = document.createElement('p'); error.className = 'metadata-error'; error.textContent = parsed.metadata.error; preview.prepend(error); }
  el('words').textContent = `${parsed.body.trim().split(/\s+/).filter(Boolean).length} words`;
  const headingCounts = new Map<string, number>();
  preview.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
    const base = headingId(h.textContent || ''), count = headingCounts.get(base) || 0;
    headingCounts.set(base,count+1); h.id = count ? `${base}-${count}` : base;
  });
  const links = [...preview.querySelectorAll<HTMLAnchorElement>('a[href]')];
  for (const link of links) {
    const href = link.getAttribute('href')!;
    link.onclick = e => {
      e.preventDefault();
      if (/^(https?:|mailto:)/i.test(href)) { void invoke('open_external', { url: href }).catch(notice); return; }
      const target = localTarget(path, href);
      if (!target) { notice('That link points outside the open folder or uses an unsupported URL.'); return; }
      const entry = folder?.entries.find(e => e.path === target.path);
      if (entry?.kind === 'image') void inspectImage(entry.path, entry.name);
      else if (entry?.kind === 'note') navigate(target.path, target.hash);
      else notice(`Cannot find “${target.path}” in this folder. Try Refresh if it was added recently.`);
    };
  }
  const images = [...preview.querySelectorAll<HTMLImageElement>('img')];
  renderDetails(links, images, parsed.metadata);
  await Promise.all(images.map(async image => {
    const src = image.getAttribute('src') || '';
    if (/^https:/i.test(src)) { image.referrerPolicy = 'no-referrer'; return; }
    const target = localTarget(activePath, src);
    image.removeAttribute('src');
    if (!target) { image.alt = `${image.alt || 'Image'} (unsupported path)`; return; }
    try {
      const data = await invoke<string>('read_image', { path: target.path });
      if (path !== activePath || text !== activeText || !image.isConnected) return;
      image.src = data; image.tabIndex = 0; image.setAttribute('role','button'); image.title = `Inspect ${target.path}`;
      image.onclick = () => { void inspectImage(target.path, image.alt); };
      image.onkeydown = e => { if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); image.click(); } };
    } catch { image.alt = `${image.alt || 'Image'} — unavailable: ${target.path}`; }
  }));
}
function renderDetails(links: HTMLAnchorElement[], images: HTMLImageElement[], metadata: NoteMetadata) {
  const box = el('details-content'); box.replaceChildren();
  const section = (label: string, lines: string[]) => {
    const h = document.createElement('h3'); h.textContent = label; box.append(h);
    for(const line of lines.length ? lines : ['None on this page.']) { const p = document.createElement('p'); p.textContent = line; box.append(p); }
  };
  section('FILE', [path]);
  section('PROPERTIES', Object.entries(metadata.properties).filter(([key]) => key !== 'tags').map(([key,value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`));
  if(metadata.tags.length) { const h = document.createElement('h3'); h.textContent = 'TAGS'; box.append(h); metadata.tags.forEach(tag => box.append(tagButton(tag))); }
  if(metadata.error) section('FRONTMATTER ERROR', [metadata.error]);
  section(`IMAGES · ${images.length}`, images.map(img => `${img.alt || 'No description'}\n${img.getAttribute('src') || ''}`));
  section(`LINKS · ${links.length}`, links.map(a => `${a.textContent}\n${a.getAttribute('href')}`));
  const hint = document.createElement('p'); hint.textContent = 'Use Edit to change image descriptions and link destinations.'; hint.className = 'detail-hint'; box.append(hint);
}
async function inspectImage(imagePath: string, description: string) {
  try {
    const data = await invoke<string>('read_image', { path: imagePath });
    el<HTMLImageElement>('large-image').src = data; el<HTMLImageElement>('large-image').alt = description;
    el('image-title').textContent = imagePath.split('/').pop()!; el('image-path').textContent = imagePath;
    el<HTMLDialogElement>('image-dialog').showModal();
  } catch(e) { notice(e); }
}
function findFiles() {
  const box = el('find-results'); box.replaceChildren();
  const q = el<HTMLInputElement>('find-input').value.toLowerCase();
  const matches = folder?.entries.filter(e => e.kind === 'note' && fileMatches(e,q,activeTag)).slice(0,100) || [];
  matches.forEach(e => box.append(makeFile(e, true)));
  if (!matches.length) box.textContent = folder ? 'No matching notes.' : 'Open a folder to find your notes.';
}
function openFinder() { findFiles(); el<HTMLDialogElement>('finder').showModal(); el<HTMLInputElement>('find-input').focus(); }

function closeFileMenu() { el('file-context').hidden = true; contextEntry = null; }
function openFileMenu(entry: Entry, anchor: HTMLElement, x = 0, y = 0) {
  if(busy || saving) return;
  contextEntry = entry; const menu = el('file-context'), bounds = anchor.getBoundingClientRect();
  menu.hidden = false;
  menu.style.left = `${Math.max(8,Math.min(x || bounds.left,window.innerWidth - 175))}px`;
  menu.style.top = `${Math.max(8,Math.min(y || bounds.bottom,window.innerHeight - 52))}px`;
  el('delete-file').focus();
}
function requestDelete() {
  const entry = contextEntry; closeFileMenu(); if(!entry || busy || saving) return;
  deletingEntry = entry;
  el('delete-title').textContent = `Move file to ${trashName}?`;
  el('delete-description').textContent = `${entry.path}\n\nYou can restore it from the ${trashName}.` + (entry.path === path && dirty() ? '\nUnsaved changes in this note will be discarded.' : '');
  el('confirm-delete').textContent = `Move to ${trashName}`;
  el<HTMLDialogElement>('delete-dialog').showModal(); el('cancel-delete').focus();
}
async function deleteSelectedFile() {
  const entry = deletingEntry; if(!entry || busy || saving) return;
  busy = true; el<HTMLButtonElement>('confirm-delete').disabled = true;
  try {
    const warning = await invoke<string | null>('delete_file', {path: entry.path});
    generation++; editorStates.delete(entry.path);
    if(folder) folder.entries = folder.entries.filter(item => item.path !== entry.path);
    if(entry.path === path) {
      clearTimeout(editTimer);
      path = ''; text = original = ''; editor.setState(noteState(''));
      el('preview').replaceChildren(); el('details-content').replaceChildren(); el('preview').hidden = el('editor').hidden = true;
      el('empty').hidden = false; el('empty').querySelector('h1')!.textContent = 'File moved to ' + trashName + '.';
      el('empty').querySelector('p:not(.eyebrow)')!.textContent = 'Choose another note from Files.';
      el('breadcrumbs').textContent = folder?.name || 'Your field notes';
      togglePane('files-pane','files',true); updateStatus();
    }
    renderTree(); el<HTMLDialogElement>('delete-dialog').close(); deletingEntry = null;
    el('status').textContent = `Moved ${entry.name} to ${trashName}`;
    clearNotice(); if(warning) notice(warning);
  } catch(error) { notice(error); el<HTMLDialogElement>('delete-dialog').close(); }
  finally { busy = false; el<HTMLButtonElement>('confirm-delete').disabled = false; }
}

el('open-folder').onclick = el('empty-open').onclick = () => { void chooseTarget('folder'); };
el('open-file').onclick = () => { void chooseTarget('file'); };
el('files').onclick = () => { togglePane('files-pane','files'); if(!el('files-pane').hidden)el('filter').focus(); };
el('close-files').onclick = () => { togglePane('files-pane','files',false); el('files').focus(); };
el('details').onclick = () => togglePane('details-pane','details');
el('close-details').onclick = () => { togglePane('details-pane','details',false); el('details').focus(); };
el('read').onclick = () => setMode(false); el('edit').onclick = () => setMode(true);
el('save').onclick = () => { void save(); }; el('filter').oninput = renderTree;
el('find').onclick = openFinder; el('find-input').oninput = findFiles;
el('close-finder').onclick = () => el<HTMLDialogElement>('finder').close();
el('close-image').onclick = () => el<HTMLDialogElement>('image-dialog').close();
el('dismiss-notice').onclick = clearNotice;
el('delete-file').onclick = requestDelete;
el('confirm-delete').onclick = () => { void deleteSelectedFile(); };
el('cancel-delete').onclick = () => { deletingEntry = null; el<HTMLDialogElement>('delete-dialog').close(); };
el<HTMLDialogElement>('delete-dialog').oncancel = () => { deletingEntry = null; };
document.addEventListener('pointerdown', event => { if(!el('file-context').contains(event.target as Node)) closeFileMenu(); });
el('refresh').onclick = async () => { if(!folder || busy) return; busy = true; try { folder = await invoke<Folder>('list_files'); renderTree(); } catch(e) { notice(e); } finally { busy = false; } };
el('cancel-leave').onclick = () => { afterLeave = null; el<HTMLDialogElement>('unsaved').close(); };
el<HTMLDialogElement>('unsaved').oncancel = () => { afterLeave = null; };
async function finishLeave(keep: boolean) {
  const action = afterLeave; afterLeave = null; el<HTMLDialogElement>('unsaved').close();
  if (keep && !await save()) return;
  if (!keep) { editorStates.delete(path); text = original; editor.setState(noteState(original)); updateStatus(); void renderNote(); }
  if(action) await action();
}
el('save-leave').onclick = () => { void finishLeave(true); };
el('discard-leave').onclick = () => { void finishLeave(false); };
document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && !el('file-context').hidden) { closeFileMenu(); e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && ['s','o','k'].includes(e.key.toLowerCase())) {
    e.preventDefault(); if(document.querySelector('dialog[open]'))return;
    if(e.key.toLowerCase()==='s')void save(); else if(e.key.toLowerCase()==='o')void chooseTarget(e.shiftKey ? 'folder' : 'file'); else openFinder();
  }
  if(e.key==='Escape' && !document.querySelector('dialog[open]')) { togglePane('files-pane','files',false); togglePane('details-pane','details',false); }
});
if(native) {
  void getCurrentWindow().onCloseRequested(async e => {
    if(dirty() || saving || busy) { e.preventDefault(); if(!saving && !busy) await mayLeave(async () => { await getCurrentWindow().destroy(); }); }
  });
}
updateStatus();
async function restoreStartup() {
  if (!native) return;
  busy = true;
  try { const opened = await invoke<Opened | null>('startup'); if(opened) await applyOpened(opened); }
  catch(e) { notice(e); }
  finally { busy = false; }
}
void restoreStartup();
