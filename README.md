# Longview

A quiet desktop workspace for a folder of Markdown files. Windows, macOS, and Linux are the target platforms. The interface follows the **Focus** layout in `layout-studies`, with warm paper, charcoal ink, and muted olive accents.

## Downloads and releases

Download installers from [GitHub Releases](https://github.com/Punk-Science-Studios-Inc/longview/releases): Windows `.exe`/`.msi`, macOS `.dmg` for Apple Silicon and Intel, and Linux `.deb`/`.AppImage` for x64.

The `Desktop installers` workflow tests and builds all four targets on pushes to `main`, pull requests, and manual runs. Each successful job uploads installers as downloadable workflow artifacts. Pushing a version tag such as `v0.1.0` publishes a GitHub Release with all six installers and SHA-256 checksums, after every platform succeeds. The tag must match the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.

Windows installers are currently unsigned. macOS builds use an ad-hoc signature and are not notarized. Trusted publisher signing and Apple notarization require certificates; this workflow does not pretend those are configured.

## Install the lv command on Windows

From this checkout, run PowerShell:

```powershell
./scripts/install-windows.ps1
```

This builds the release executable and installs it as `~/.local/bin/lv.exe`, ensuring that directory is on your user PATH. Then run `lv`, `lv "C:\\path\\to\\note.md"`, or `lv "C:\\path\\to\\folder"`. Open a new terminal if it has an older PATH. Run the installer again after updating the source. This command-line installation is independent of the graphical installers.

## Run

Install Node.js, Rust, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/), then:

```sh
npm install
npm run tauri dev
```

To build the desktop executable without an installer:

```sh
npm run tauri build -- --no-bundle
```

`npm run dev` serves the interface for layout work. Opening folders requires the desktop application.

Pass a Markdown file or folder as the first command-line argument. Quote paths containing spaces:

```sh
longview "/path/to/Field notes"
longview "/path/to/Field notes/Journal/Coastal walk.md"
```

With no argument, Longview restores the last successfully opened file or folder. The configuration is stored at **`~/.config/longview/config.json`** on every platform, including Windows and macOS. An explicit command-line path takes precedence over the saved target. Missing targets or unreadable configuration produce an error in the window; Open File or Open Folder can select a replacement.

Opening a folder shows the Files column and previews the first note without replacing the saved folder target. Explicitly selecting a note from the tree, search, or a document link saves that file as the most recently opened target. Opening a file directly uses its parent folder for relative images and links.

## First version

- Open a real folder and browse its Markdown files and images.
- Read rendered Markdown or edit source with CodeMirror, undo, and syntax highlighting.
- Save with Ctrl/Cmd+S; file changes made outside Longview produce a conflict message rather than an overwrite.
- Follow relative note links and headings, inspect local images, and open web links in the default browser.
- Use Ctrl/Cmd+O to open a file, Ctrl/Cmd+Shift+O to choose a folder, and Ctrl/Cmd+K to find a note. Files is visible when opening a folder and can be toggled on demand.
- Save, discard, or cancel before switching documents or closing with unsaved changes.

The original files remain the source of truth. Saves use a temporary file in the same directory and an atomic replacement. An external-edit check runs before replacement; this is not a distributed lock against other programs writing at precisely the same instant. Preserve backups as usual.

This first version edits existing notes. Creating/renaming files, filesystem watching, backlinks, and installers are follow-up work. Refresh rescans the tree; it does not replace a note currently being edited. Hidden directories, symlinks, `node_modules`, and `target` are excluded from the tree. Markdown files must be UTF-8 and at most 5 MiB; images at most 20 MiB.

## Structure

- `crates/longview-core`: folder scanning, scoped file access, conflict detection, atomic saves.
- `src-tauri`: native folder picker, window, and narrow Rust commands.
- `src`: TypeScript interface, CodeMirror, sanitized Markdown rendering, relative link resolution.
- `layout-studies`: separately published design exploration, retained as the visual reference.

## Checks

```sh
npm run build
npm test
cargo test -p longview-core
cargo check -p longview
```

The Rust core has no dependency on Tauri. The frontend has no general filesystem or shell capability. It accesses notes and images through commands scoped to the folder selected in the native picker. Rendered Markdown is sanitized and the desktop CSP blocks executable document content.
