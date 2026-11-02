//! Opening and remembering targets is one operation, shared by startup and pickers.
use crate::{Folder, Workspace};
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsString,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "path", rename_all = "snake_case")]
pub enum OpenTarget {
    File(PathBuf),
    Folder(PathBuf),
}

#[derive(Default, Serialize, Deserialize)]
struct Config {
    last_opened: Option<OpenTarget>,
}

#[derive(Serialize)]
pub struct Opened {
    pub folder: Folder,
    /// None means the user opened the folder itself, rather than a specific note.
    pub file: Option<String>,
}

pub struct Session {
    workspace: Option<Workspace>,
    config_path: PathBuf,
}

impl Session {
    /// Always use ~/.config, including on Windows and macOS.
    pub fn for_home(home: impl AsRef<Path>) -> Self {
        Self {
            workspace: None,
            config_path: home.as_ref().join(".config/longview/config.json"),
        }
    }

    pub fn workspace(&self) -> Result<&Workspace, String> {
        self.workspace
            .as_ref()
            .ok_or_else(|| "Open a folder or file first.".into())
    }

    pub fn startup(&mut self, arguments: &[OsString]) -> Result<Option<Opened>, String> {
        let arguments = if arguments.first().is_some_and(|a| a == "--") {
            &arguments[1..]
        } else {
            arguments
        };
        match arguments {
            [] => match self.load_config()?.last_opened {
                Some(target) => self.open_target(target).map(Some),
                None => Ok(None),
            },
            [path] => self.open_path(Path::new(path)).map(Some),
            _ => Err("Open one Markdown file or folder at a time.".into()),
        }
    }

    pub fn open_path(&mut self, path: &Path) -> Result<Opened, String> {
        let path =
            fs::canonicalize(path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
        self.open_target(if path.is_dir() {
            OpenTarget::Folder(path)
        } else {
            OpenTarget::File(path)
        })
    }

    fn open_target(&mut self, target: OpenTarget) -> Result<Opened, String> {
        // Validate everything before committing either the session or its saved target.
        let (workspace, file, target) = match target {
            OpenTarget::Folder(path) => {
                let workspace = Workspace::open(path)?;
                let target = OpenTarget::Folder(workspace.root.clone());
                (workspace, None, target)
            }
            OpenTarget::File(path) => {
                let path =
                    fs::canonicalize(path).map_err(|e| format!("Cannot restore file: {e}"))?;
                let parent = path.parent().ok_or("The file has no parent folder.")?;
                let name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .ok_or("The filename must be UTF-8.")?
                    .to_owned();
                let workspace = Workspace::open(parent)?;
                workspace.read_note(&name)?;
                (workspace, Some(name), OpenTarget::File(path))
            }
        };
        let folder = workspace.list()?;
        self.remember(target)?;
        self.workspace = Some(workspace);
        Ok(Opened { folder, file })
    }

    /// Previewing the first note in an opened folder must not change the saved folder.
    pub fn read_note(&self, relative: &str, remember: bool) -> Result<String, String> {
        let workspace = self.workspace()?;
        let text = workspace.read_note(relative)?;
        if remember {
            self.remember(OpenTarget::File(workspace.resolve(relative)?))?;
        }
        Ok(text)
    }

    /// Only use the system trash; never fall back to permanent deletion.
    pub fn delete_file(&self, relative: &str) -> Result<Option<String>, String> {
        self.delete_file_with(relative, |path| {
            trash::delete(path).map_err(|e| e.to_string())
        })
    }

    fn delete_file_with(
        &self,
        relative: &str,
        remove: impl FnOnce(&Path) -> Result<(), String>,
    ) -> Result<Option<String>, String> {
        let workspace = self.workspace()?;
        let path = workspace.deletable_path(relative)?;
        remove(&path)?;
        // Deleting the remembered note should restore its folder next time, not a missing file.
        let repair = || -> Result<(), String> {
            if self.load_config()?.last_opened == Some(OpenTarget::File(path)) {
                self.remember(OpenTarget::Folder(workspace.root.clone()))?;
            }
            Ok(())
        };
        Ok(repair().err().map(|error| {
            format!(
                "File moved to Trash, but the last-opened setting could not be updated: {error}"
            )
        }))
    }

    fn load_config(&self) -> Result<Config, String> {
        match fs::read(&self.config_path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| format!("Cannot read {}: {e}", self.config_path.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
            Err(e) => Err(format!("Cannot read {}: {e}", self.config_path.display())),
        }
    }

    fn remember(&self, target: OpenTarget) -> Result<(), String> {
        let write = || -> Result<(), Box<dyn std::error::Error>> {
            let parent = self.config_path.parent().unwrap();
            fs::create_dir_all(parent)?;
            let mut file = tempfile::NamedTempFile::new_in(parent)?;
            serde_json::to_writer_pretty(
                &mut file,
                &Config {
                    last_opened: Some(target),
                },
            )?;
            file.write_all(b"\n")?;
            file.as_file().sync_all()?;
            file.persist(&self.config_path)?;
            Ok(())
        };
        write().map_err(|e| format!("Cannot save {}: {e}", self.config_path.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Uses the desktop OS Trash; run explicitly on a desktop session."]
    fn recycles_own_temporary_note() {
        let (home, _, note) = sample();
        let mut session = Session::for_home(home.path());
        session.open_path(&note).unwrap();
        assert!(session.delete_file("Café walk.md").unwrap().is_none());
        assert!(!note.exists());
        assert!(session.startup(&[]).unwrap().unwrap().file.is_none());
    }
    fn sample() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let folder = temp.path().join("Field notes");
        fs::create_dir(&folder).unwrap();
        let note = folder.join("Café walk.md");
        fs::write(&note, "# A quiet walk").unwrap();
        (temp, folder, note)
    }
    #[test]
    fn first_launch_does_not_create_config() {
        let home = tempfile::tempdir().unwrap();
        let mut session = Session::for_home(home.path());
        assert!(session.startup(&[]).unwrap().is_none());
        assert!(!home.path().join(".config").exists());
    }
    #[test]
    fn command_line_folder_restores_as_folder_even_after_automatic_preview() {
        let (home, folder, _) = sample();
        let mut session = Session::for_home(home.path());
        let opened = session
            .startup(&[folder.into_os_string()])
            .unwrap()
            .unwrap();
        assert!(opened.file.is_none());
        session.read_note("Café walk.md", false).unwrap();
        let restored = Session::for_home(home.path())
            .startup(&[])
            .unwrap()
            .unwrap();
        assert!(restored.file.is_none());
        let json: serde_json::Value = serde_json::from_slice(
            &fs::read(home.path().join(".config/longview/config.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(json["last_opened"]["kind"], "folder");
    }
    #[test]
    fn command_line_file_overrides_saved_folder_and_restores_with_spaces_and_unicode() {
        let (home, folder, note) = sample();
        Session::for_home(home.path()).open_path(&folder).unwrap();
        let opened = Session::for_home(home.path())
            .startup(&[note.into_os_string()])
            .unwrap()
            .unwrap();
        assert_eq!(opened.file.as_deref(), Some("Café walk.md"));
        assert_eq!(
            Session::for_home(home.path())
                .startup(&[])
                .unwrap()
                .unwrap()
                .file,
            opened.file
        );
    }
    #[test]
    fn in_app_file_and_folder_opening_replace_each_other() {
        let (home, folder, note) = sample();
        let mut session = Session::for_home(home.path());
        session.open_path(&note).unwrap();
        session.open_path(&folder).unwrap();
        assert!(Session::for_home(home.path())
            .startup(&[])
            .unwrap()
            .unwrap()
            .file
            .is_none());
        // Selecting a note in the tree is an explicit file open too.
        session.read_note("Café walk.md", true).unwrap();
        assert_eq!(
            Session::for_home(home.path())
                .startup(&[])
                .unwrap()
                .unwrap()
                .file
                .as_deref(),
            Some("Café walk.md")
        );
    }
    #[test]
    fn unsuccessful_opens_preserve_previous_target() {
        let (home, folder, _) = sample();
        let mut session = Session::for_home(home.path());
        session.open_path(&folder).unwrap();
        let before = fs::read(&session.config_path).unwrap();
        assert!(session.open_path(&folder.join("missing.md")).is_err());
        fs::write(folder.join("bad.md"), [0xff]).unwrap();
        assert!(session.open_path(&folder.join("bad.md")).is_err());
        assert!(session.read_note("../outside.md", true).is_err());
        assert_eq!(fs::read(&session.config_path).unwrap(), before);
    }
    #[test]
    fn missing_restored_target_does_not_erase_config() {
        let (home, _, note) = sample();
        let mut session = Session::for_home(home.path());
        session.open_path(&note).unwrap();
        let before = fs::read(&session.config_path).unwrap();
        fs::remove_file(note).unwrap();
        assert!(session.startup(&[]).is_err());
        assert_eq!(fs::read(&session.config_path).unwrap(), before);
    }
    #[test]
    fn reports_corrupt_config_but_explicit_path_can_recover_it() {
        let (home, folder, _) = sample();
        let mut session = Session::for_home(home.path());
        fs::create_dir_all(session.config_path.parent().unwrap()).unwrap();
        fs::write(&session.config_path, "broken json").unwrap();
        assert!(session.startup(&[]).is_err());
        assert!(session.startup(&[folder.into_os_string()]).is_ok());
        assert!(session.startup(&[]).is_ok());
    }

    #[test]
    fn deleting_last_opened_note_remembers_parent_and_never_deletes_folders_or_outside_files() {
        let (home, folder, note) = sample();
        let mut session = Session::for_home(home.path());
        session.open_path(&note).unwrap();
        session
            .delete_file_with("Café walk.md", |path| {
                fs::remove_file(path).map_err(|e| e.to_string())
            })
            .unwrap();
        assert!(!note.exists());
        assert!(session.startup(&[]).unwrap().unwrap().file.is_none());
        assert_eq!(
            session.workspace().unwrap().root,
            fs::canonicalize(folder).unwrap()
        );
        assert!(session
            .delete_file_with(".", |_| panic!("Must not delete a folder"))
            .is_err());
        assert!(session
            .delete_file_with("../outside.md", |_| panic!(
                "Must not delete outside the workspace"
            ))
            .is_err());
    }

    #[test]
    fn failed_trash_operation_preserves_the_file_and_config() {
        let (home, _, note) = sample();
        let mut session = Session::for_home(home.path());
        session.open_path(&note).unwrap();
        let config = fs::read(&session.config_path).unwrap();
        assert!(session
            .delete_file_with("Café walk.md", |_| Err("Trash unavailable".into()))
            .is_err());
        assert!(note.exists());
        assert_eq!(fs::read(&session.config_path).unwrap(), config);
    }
}
