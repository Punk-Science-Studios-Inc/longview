//! Literal, case-insensitive content search within the open workspace.
use crate::{is_markdown, Workspace, NOTE_LIMIT};
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};

const RESULT_LIMIT: usize = 200;

#[derive(Deserialize)]
pub struct SearchDraft {
    pub path: String,
    pub text: String,
}

#[derive(Debug, Serialize)]
pub struct SearchHit {
    pub path: String,
    /// One-based source line; column and length use UTF-16 for the editor.
    pub line: usize,
    pub column: usize,
    pub length: usize,
    pub before: String,
    pub matched: String,
    pub after: String,
}

#[derive(Debug, Default, Serialize)]
pub struct SearchResults {
    pub hits: Vec<SearchHit>,
    pub truncated: bool,
    pub skipped: usize,
}

impl Workspace {
    pub fn search_notes(
        &self,
        query: &str,
        draft: Option<&SearchDraft>,
    ) -> Result<SearchResults, String> {
        let query = query.trim();
        let mut results = SearchResults::default();
        if query.is_empty() {
            return Ok(results);
        }
        if query.chars().count() > 256 {
            return Err("Search for up to 256 characters at a time.".into());
        }
        if draft.is_some_and(|draft| draft.text.len() as u64 > NOTE_LIMIT) {
            return Err("The current note exceeds the 5 MiB search limit.".into());
        }
        let pattern = RegexBuilder::new(&regex::escape(query))
            .case_insensitive(true)
            .build()
            .map_err(|e| e.to_string())?;
        for item in self.walk() {
            let item = match item {
                Ok(item) => item,
                Err(_) => {
                    results.skipped += 1;
                    continue;
                }
            };
            if !item.file_type().is_file() || !is_markdown(item.path()) {
                continue;
            }
            let path = item
                .path()
                .strip_prefix(&self.root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            // Scoped reads enforce the same containment, UTF-8 and size rules as opening notes.
            let saved = match self.read_note(&path) {
                Ok(text) => text,
                Err(_) => {
                    results.skipped += 1;
                    continue;
                }
            };
            let text = draft
                .filter(|draft| draft.path == path)
                .map_or(saved.as_str(), |draft| draft.text.as_str());
            for (line, contents) in text.lines().enumerate() {
                let Some(found) = pattern.find(contents) else {
                    continue;
                };
                if results.hits.len() == RESULT_LIMIT {
                    results.truncated = true;
                    return Ok(results);
                }
                let prefix = &contents[..found.start()];
                let suffix = &contents[found.end()..];
                let start = prefix.char_indices().rev().nth(79).map_or(0, |(i, _)| i);
                let end = suffix
                    .char_indices()
                    .nth(160)
                    .map_or(suffix.len(), |(i, _)| i);
                results.hits.push(SearchHit {
                    path: path.clone(),
                    line: line + 1,
                    column: prefix.encode_utf16().count(),
                    length: found.as_str().encode_utf16().count(),
                    before: format!("{}{}", if start > 0 { "…" } else { "" }, &prefix[start..]),
                    matched: found.as_str().into(),
                    after: format!(
                        "{}{}",
                        &suffix[..end],
                        if end < suffix.len() { "…" } else { "" }
                    ),
                });
            }
        }
        Ok(results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn finds_contents_in_nested_notes_with_unicode_literal_matching_and_source_locations() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("Journal")).unwrap();
        fs::write(
            dir.path().join("Journal/walk.MARKDOWN"),
            "---\r\ntags: [outdoors]\r\n---\r\n🌲 A CAFÉ [quiet].\r\nAnother café [quiet].",
        )
        .unwrap();
        fs::write(dir.path().join("café [quiet].md"), "No matching contents").unwrap();
        let results = Workspace::open(dir.path())
            .unwrap()
            .search_notes("  café [quiet]  ", None)
            .unwrap();
        assert_eq!(results.hits.len(), 2);
        let hit = &results.hits[0];
        assert_eq!(hit.path, "Journal/walk.MARKDOWN");
        assert_eq!(hit.line, 4);
        assert_eq!(hit.column, 5);
        assert_eq!(hit.length, 12);
        assert_eq!(hit.matched, "CAFÉ [quiet]");
        assert_eq!(hit.before, "🌲 A ");
        assert_eq!(hit.after, ".");
        assert!(!results.truncated);
    }

    #[test]
    fn searches_current_disk_contents_and_unsaved_draft_without_writing_it() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("note.md"), "old contents").unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        fs::write(dir.path().join("note.md"), "new contents").unwrap();
        assert_eq!(workspace.search_notes("new", None).unwrap().hits.len(), 1);
        let draft = SearchDraft {
            path: "note.md".into(),
            text: "unsaved contents".into(),
        };
        assert_eq!(
            workspace
                .search_notes("unsaved", Some(&draft))
                .unwrap()
                .hits
                .len(),
            1
        );
        assert!(workspace
            .search_notes("new", Some(&draft))
            .unwrap()
            .hits
            .is_empty());
        assert_eq!(
            fs::read_to_string(dir.path().join("note.md")).unwrap(),
            "new contents"
        );
        let outside = SearchDraft {
            path: "../outside.md".into(),
            text: "secret".into(),
        };
        assert!(workspace
            .search_notes("secret", Some(&outside))
            .unwrap()
            .hits
            .is_empty());
    }

    #[test]
    fn excludes_hidden_tool_and_non_note_files_and_reports_unreadable_notes() {
        let dir = tempfile::tempdir().unwrap();
        for folder in [".private", "node_modules", "target"] {
            fs::create_dir(dir.path().join(folder)).unwrap();
            fs::write(dir.path().join(folder).join("note.md"), "needle").unwrap();
        }
        for name in [".hidden.md", "image.svg", "text.txt"] {
            fs::write(dir.path().join(name), "needle").unwrap();
        }
        fs::write(dir.path().join("valid.md"), "needle").unwrap();
        fs::write(dir.path().join("invalid.md"), [0xff]).unwrap();
        fs::File::create(dir.path().join("large.md"))
            .unwrap()
            .set_len(NOTE_LIMIT + 1)
            .unwrap();
        let results = Workspace::open(dir.path())
            .unwrap()
            .search_notes("needle", None)
            .unwrap();
        assert_eq!(results.hits.len(), 1);
        assert_eq!(results.hits[0].path, "valid.md");
        assert_eq!(results.skipped, 2);
    }

    #[cfg(unix)]
    #[test]
    fn does_not_search_symlinked_notes_or_directories() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.md"), "needle").unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.md"), dir.path().join("link.md"))
            .unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("linked-folder")).unwrap();
        assert!(Workspace::open(dir.path())
            .unwrap()
            .search_notes("needle", None)
            .unwrap()
            .hits
            .is_empty());
    }

    #[test]
    fn bounds_results_and_excerpts_without_splitting_unicode() {
        let dir = tempfile::tempdir().unwrap();
        let line = format!("{}needle{}\n", "🌲".repeat(200), "é".repeat(300));
        fs::write(dir.path().join("many.md"), line.repeat(RESULT_LIMIT)).unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        let results = workspace.search_notes("needle", None).unwrap();
        assert_eq!(results.hits.len(), RESULT_LIMIT);
        assert!(!results.truncated);
        assert_eq!(results.hits[0].before, format!("…{}", "🌲".repeat(80)));
        assert_eq!(results.hits[0].after, format!("{}…", "é".repeat(160)));
        fs::write(dir.path().join("many.md"), line.repeat(RESULT_LIMIT + 1)).unwrap();
        assert!(workspace.search_notes("needle", None).unwrap().truncated);
        assert!(workspace
            .search_notes(" \t ", None)
            .unwrap()
            .hits
            .is_empty());
        assert!(workspace.search_notes(&"a".repeat(257), None).is_err());
    }
}
