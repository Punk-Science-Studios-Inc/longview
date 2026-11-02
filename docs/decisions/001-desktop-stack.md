# Desktop stack

Date: 2026-11-02. Status: accepted by the project owner.

Longview targets Windows, macOS, and Linux desktop using **Tauri 2**, a **Rust core**, and a **TypeScript/CSS interface**. Vite builds the frontend. CodeMirror provides source editing; Marked parses Markdown and DOMPurify sanitizes the rendered HTML.

The accepted visual direction is layout 02, **Focus**: a centered document, a labelled Files drawer, a small Read/Edit switch, and details revealed on demand. Preserve the reference proportions and typography. Use warm paper `#F7F0DF`, charcoal-brown ink `#332E26`, muted olive `#586343`, and parchment borders `#D9CFBA`.

The filesystem model lives in `longview-core`, independent of the shell. Existing Markdown and associated images remain ordinary files; no import database or proprietary storage format is required. The native shell owns folder selection. UI commands cannot name an arbitrary workspace root.
