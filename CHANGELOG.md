# Changelog

## Unreleased

- Make displayed vault/file paths and Details links clickable, with file-explorer actions for every file and folder.
- Show other file types and empty folders in Files; open folder and attachment links in the system file explorer.
- Support absolute paths and file URLs, link-like properties, inline references, and linked images while preserving note navigation and scoped file access.
- Add New file and New folder buttons to the Files pane, creating items in the selected folder (or the open note's folder) and opening new notes automatically.
- Add Expand all and Collapse all buttons to the Files pane; empty folders are now listed when no filter is active.
- Render Obsidian-style `![[image]]` and `![[image|width]]` embeds inline in previews, resolved note-relative, vault-relative, or by name anywhere in the folder; missing images show a clear placeholder.
- Delete now works on folders as well as files from the Files context menu: files move to Trash immediately, folders ask for confirmation first.

## 0.3.0

- Replace the duplicate file finder with vault-wide content search, including highlighted excerpts, line locations, keyboard navigation, and the active note's unsaved text.
- Use Ctrl/Cmd+K to focus the Files filter and Ctrl/Cmd+Shift+F to search all note contents independently of sidebar filters.

## 0.2.0

- Apply the Longview sunset-and-Markdown-rule icon and supplied wordmark throughout the app and installer icons.
- Display YAML frontmatter as note properties, preserving the full original source in Edit mode.
- Index frontmatter tags across the open folder. Click a tag on a note or in Files to filter notes; match case-insensitively and include nested tags.
- Filter filenames, titles, and tags together. Keep only matching files and their parent folders visible.
- Add a Files context menu with Delete, an explicit confirmation, and system Trash/Recycle Bin support for notes and images.
- Protect unsaved changes and update the saved startup target when the last-opened note is deleted.

## 0.1.0

- Initial Tauri desktop release for Windows, macOS, and Linux.
- Read and edit Markdown, browse folders, inspect images, and follow document links.
- Restore the last-opened file or folder from `~/.config/longview/config.json`.
