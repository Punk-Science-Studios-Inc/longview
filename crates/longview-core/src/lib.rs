//! Filesystem operations independent of the desktop shell.
pub mod metadata;
pub mod session;
use serde::Serialize;
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
use walkdir::WalkDir;

const NOTE_LIMIT: u64 = 5 * 1024 * 1024;
const IMAGE_LIMIT: u64 = 20 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct Entry {
    pub path: String,
    pub name: String,
    pub kind: &'static str,
    pub tags: Vec<String>,
    pub title: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Folder {
    pub name: String,
    pub entries: Vec<Entry>,
}

#[derive(Debug)]
pub struct Workspace {
    root: PathBuf,
}

impl Workspace {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, String> {
        let root = fs::canonicalize(path).map_err(|e| e.to_string())?;
        if !root.is_dir() {
            return Err("Choose a folder.".into());
        }
        Ok(Self { root })
    }

    pub fn list(&self) -> Result<Folder, String> {
        let mut entries = Vec::new();
        // Never follow symlinks or descend into hidden/tool directories.
        for item in WalkDir::new(&self.root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                e.depth() == 0
                    || !e.file_name().to_string_lossy().starts_with('.')
                        && !matches!(e.file_name().to_str(), Some("node_modules" | "target"))
            })
        {
            let item = item.map_err(|e| e.to_string())?;
            if item.depth() == 0 || item.file_type().is_symlink() {
                continue;
            }
            let kind = if item.file_type().is_dir() {
                "folder"
            } else if is_markdown(item.path()) {
                "note"
            } else if image_mime(item.path()).is_some() {
                "image"
            } else {
                continue;
            };
            let metadata = if kind == "note" {
                metadata::read_metadata(item.path())
            } else {
                Default::default()
            };
            entries.push(Entry {
                path: item
                    .path()
                    .strip_prefix(&self.root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/"),
                name: item.file_name().to_string_lossy().into_owned(),
                kind,
                title: metadata
                    .properties
                    .get("title")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned),
                tags: metadata.tags,
            });
            if entries.len() > 50_000 {
                return Err(
                    "This folder contains more than 50,000 supported items. Open a smaller folder."
                        .into(),
                );
            }
        }
        entries.sort_by_cached_key(|entry| entry.path.to_lowercase());
        Ok(Folder {
            name: self
                .root
                .file_name()
                .unwrap_or(self.root.as_os_str())
                .to_string_lossy()
                .into_owned(),
            entries,
        })
    }

    fn resolve(&self, relative: &str) -> Result<PathBuf, String> {
        let relative = Path::new(relative);
        if relative.is_absolute()
            || relative.components().any(|c| {
                matches!(
                    c,
                    Component::ParentDir | Component::Prefix(_) | Component::RootDir
                )
            })
        {
            return Err("The file must be inside the open folder.".into());
        }
        let path = fs::canonicalize(self.root.join(relative)).map_err(|e| e.to_string())?;
        if !path.starts_with(&self.root) || !path.is_file() {
            return Err("The file must be inside the open folder.".into());
        }
        Ok(path)
    }

    fn deletable_path(&self, relative: &str) -> Result<PathBuf, String> {
        let path = self.resolve(relative)?;
        if fs::symlink_metadata(self.root.join(relative))
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("Symbolic links cannot be deleted from Files.".into());
        }
        if !is_markdown(&path) && image_mime(&path).is_none() {
            return Err("Only Markdown files and supported images can be moved to Trash.".into());
        }
        Ok(path)
    }

    pub fn read_note(&self, relative: &str) -> Result<String, String> {
        let path = self.resolve(relative)?;
        if !is_markdown(&path) {
            return Err("Choose a Markdown file (.md or .markdown).".into());
        }
        String::from_utf8(read_limited(&path, NOTE_LIMIT)?)
            .map_err(|_| "This note is not UTF-8 text.".into())
    }

    /// Detect external edits before replacing a note atomically in its own directory.
    pub fn save_note(&self, relative: &str, text: &str, expected: &str) -> Result<(), String> {
        if text.len() as u64 > NOTE_LIMIT {
            return Err("Notes must be smaller than 5 MiB.".into());
        }
        let path = self.resolve(relative)?;
        if self.read_note(relative)? != expected {
            return Err("This file changed outside Longview. Your edits are still here. Copy them before reopening the file to compare versions.".into());
        }
        let permissions = fs::metadata(&path)
            .map_err(|e| e.to_string())?
            .permissions();
        if permissions.readonly() {
            return Err("This file is read-only.".into());
        }
        let mut temporary =
            tempfile::NamedTempFile::new_in(path.parent().unwrap()).map_err(|e| e.to_string())?;
        temporary
            .write_all(text.as_bytes())
            .map_err(|e| e.to_string())?;
        temporary
            .as_file()
            .set_permissions(permissions)
            .map_err(|e| e.to_string())?;
        temporary.as_file().sync_all().map_err(|e| e.to_string())?;
        temporary.persist(&path).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn read_image(&self, relative: &str) -> Result<(&'static str, Vec<u8>), String> {
        let path = self.resolve(relative)?;
        let mime = image_mime(&path).ok_or("Unsupported image format.")?;
        Ok((mime, read_limited(&path, IMAGE_LIMIT)?))
    }
}

fn read_limited(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > limit {
        return Err(format!(
            "File exceeds the {} MiB size limit.",
            limit / 1024 / 1024
        ));
    }
    let mut data = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    if data.len() as u64 > limit {
        return Err("File grew beyond the size limit while reading.".into());
    }
    Ok(data)
}

fn is_markdown(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("md" | "markdown")
    )
}

fn image_mime(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "avif" => Some("image/avif"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn indexes_frontmatter_tags_and_tolerates_malformed_metadata() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("nostr.md"),
            "---\ntitle: Get on Nostr\ntags: [idea, nostr, web]\n---\nBody",
        )
        .unwrap();
        fs::write(dir.path().join("broken.md"), "---\ntags: [bad\n---\nBody").unwrap();
        let entries = Workspace::open(dir.path()).unwrap().list().unwrap().entries;
        let note = entries.iter().find(|e| e.name == "nostr.md").unwrap();
        assert_eq!(note.title.as_deref(), Some("Get on Nostr"));
        assert_eq!(note.tags, ["idea", "nostr", "web"]);
        assert!(entries
            .iter()
            .find(|e| e.name == "broken.md")
            .unwrap()
            .tags
            .is_empty());
    }
    #[test]
    fn lists_notes_images_and_folders_without_tool_directories() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("Journal")).unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join("Journal/Walk.MD"), "# Walk").unwrap();
        fs::write(dir.path().join("coast.png"), [0]).unwrap();
        fs::write(dir.path().join(".git/private.md"), "hidden").unwrap();
        fs::write(dir.path().join("unrelated.txt"), "other").unwrap();
        let folder = Workspace::open(dir.path()).unwrap().list().unwrap();
        assert_eq!(folder.entries.len(), 3);
        assert!(folder
            .entries
            .iter()
            .any(|e| e.path == "Journal/Walk.MD" && e.kind == "note"));
    }
    #[test]
    fn rejects_escape_and_non_markdown_reads() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("secret.txt"), "secret").unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        assert!(workspace.read_note("../outside.md").is_err());
        assert!(workspace.read_note("secret.txt").is_err());
        assert!(workspace
            .read_note(dir.path().join("secret.txt").to_str().unwrap())
            .is_err());
    }
    #[test]
    fn saves_unicode_and_refuses_to_overwrite_external_changes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, "# Before\r\n").unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        workspace
            .save_note("note.md", "# Après 🌿\r\n", "# Before\r\n")
            .unwrap();
        assert_eq!(workspace.read_note("note.md").unwrap(), "# Après 🌿\r\n");
        fs::write(&path, "External edit").unwrap();
        assert!(workspace
            .save_note("note.md", "My edit", "# Après 🌿\r\n")
            .is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "External edit");
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("note.md"), "private").unwrap();
        std::os::unix::fs::symlink(outside.path().join("note.md"), dir.path().join("link.md"))
            .unwrap();
        assert!(Workspace::open(dir.path())
            .unwrap()
            .read_note("link.md")
            .is_err());
    }
}
