//! YAML frontmatter is read as metadata; the source document is never rewritten.
use serde::Serialize;
use serde_json::{Map, Value};
use std::{fs::File, io::Read, path::Path};

const HEADER_LIMIT: usize = 64 * 1024;

#[derive(Debug, Default, Serialize)]
pub struct NoteMetadata {
    pub properties: Map<String, Value>,
    pub tags: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ParsedNote {
    pub body: String,
    pub metadata: NoteMetadata,
}

pub fn parse_note(source: &str) -> ParsedNote {
    let input = source.strip_prefix('\u{feff}').unwrap_or(source);
    let mut lines = input.split_inclusive('\n');
    if lines.next().map(str::trim_end) != Some("---") {
        return ParsedNote {
            body: input.into(),
            metadata: NoteMetadata::default(),
        };
    }
    let start = input.find('\n').map_or(input.len(), |n| n + 1);
    let mut end = start;
    for line in lines {
        if end > HEADER_LIMIT {
            return invalid(input, "Frontmatter exceeds 64 KiB.");
        }
        if matches!(line.trim_end(), "---" | "...") {
            let yaml = &input[start..end];
            let properties = if yaml.trim().is_empty() {
                Map::new()
            } else {
                match serde_saphyr::from_str::<Map<String, Value>>(yaml) {
                    Ok(value) => value,
                    Err(error) => {
                        return invalid(input, &format!("Invalid YAML frontmatter: {error}"))
                    }
                }
            };
            let tags = tags_from_value(properties.get("tags"));
            return ParsedNote {
                body: input[end + line.len()..].into(),
                metadata: NoteMetadata {
                    properties,
                    tags,
                    error: None,
                },
            };
        }
        end += line.len();
    }
    invalid(input, "Frontmatter is missing its closing --- delimiter.")
}

fn invalid(source: &str, message: &str) -> ParsedNote {
    ParsedNote {
        body: source.into(),
        metadata: NoteMetadata {
            error: Some(message.into()),
            ..Default::default()
        },
    }
}

pub fn normalize_tag(tag: &str) -> Option<String> {
    let tag = tag.trim().trim_start_matches('#').to_lowercase();
    if tag.is_empty() || tag.chars().any(char::is_whitespace) {
        None
    } else {
        Some(tag)
    }
}

fn tags_from_value(value: Option<&Value>) -> Vec<String> {
    let mut tags: Vec<String> = match value {
        Some(Value::Array(values)) => values
            .iter()
            .filter_map(Value::as_str)
            .filter_map(normalize_tag)
            .collect(),
        Some(Value::String(value)) => value.split(',').filter_map(normalize_tag).collect(),
        _ => Vec::new(),
    };
    tags.sort();
    tags.dedup();
    tags
}

pub(crate) fn read_metadata(path: &Path) -> NoteMetadata {
    let mut prefix = Vec::new();
    match File::open(path).and_then(|file| {
        file.take((HEADER_LIMIT + 1) as u64)
            .read_to_end(&mut prefix)
    }) {
        Ok(_) => parse_note(&String::from_utf8_lossy(&prefix)).metadata,
        Err(error) => NoteMetadata {
            error: Some(error.to_string()),
            ..Default::default()
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_user_example_and_preserves_body() {
        let note = parse_note("---\ntitle: Get on Nostr\ndate: 2026-06-16\ntags: [idea, nostr, web]\nstatus: idea\n---\n\n# Notes\nText\n");
        assert_eq!(note.metadata.properties["title"], "Get on Nostr");
        assert_eq!(note.metadata.properties["date"], "2026-06-16");
        assert_eq!(note.metadata.properties["status"], "idea");
        assert_eq!(note.metadata.tags, ["idea", "nostr", "web"]);
        assert_eq!(note.body, "\n# Notes\nText\n");
    }
    #[test]
    fn supports_block_lists_bom_crlf_nested_tags_and_unknown_properties() {
        let note = parse_note("\u{feff}---\r\ntags:\r\n  - Idea\r\n  - '#IDEA'\r\n  - work/design\r\naliases: [A, B]\r\nfavorite: true\r\n---\r\nBody\r\n");
        assert_eq!(note.metadata.tags, ["idea", "work/design"]);
        assert_eq!(note.metadata.properties["favorite"], true);
        assert_eq!(note.metadata.properties["aliases"][0], "A");
        assert_eq!(note.body, "Body\r\n");
    }
    #[test]
    fn does_not_hide_invalid_or_unterminated_frontmatter() {
        for source in [
            "---\ntags: [oops\n---\nBody",
            "---\ntitle: unfinished",
            "---\n- wrong root type\n---\nBody",
        ] {
            let note = parse_note(source);
            assert!(note.metadata.error.is_some());
            assert_eq!(note.body, source);
        }
    }
    #[test]
    fn ignores_rules_in_body_and_handles_empty_frontmatter() {
        let source = "# Heading\n\n---\n\ntags: [not-metadata]";
        assert_eq!(parse_note(source).body, source);
        assert!(parse_note(source).metadata.tags.is_empty());
        assert_eq!(parse_note("---\n---\nBody").body, "Body");
    }
    #[test]
    fn rejects_oversized_header_without_hiding_source() {
        let source = format!("---\ntitle: {}\n---\nBody", "x".repeat(HEADER_LIMIT));
        assert!(parse_note(&source).metadata.error.is_some());
        assert_eq!(parse_note(&source).body, source);
    }
    #[test]
    fn yaml_include_tags_never_read_external_files() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("private.txt");
        std::fs::write(&path, "EXTERNAL_CONTENT_MUST_NOT_BE_READ").unwrap();
        let source = format!("---\ntitle: !include '{}'\n---\nBody", path.display());
        let note = parse_note(&source);
        assert!(!format!("{:?}", note.metadata.properties)
            .contains("EXTERNAL_CONTENT_MUST_NOT_BE_READ"));
    }
}
