//! Chats and the monthly spend, stored as JSON files in the app data dir.
//!
//! Every chat is one file `chats/<id>.json`; `chats/index.json` holds the
//! summaries so the sidebar never has to open every chat.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cmp::Reverse;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSummary {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    /// The chat's folder, so a chat can be matched to a project by path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_dir: Option<String>,
    /// The chat this one branched off; the sidebar lists it below that one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch_of: Option<String>,
}

/// A folder the user added as a project; its chats may read it.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: i64,
    /// A command run after Claude changed files, such as `npm test`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub month: String,
    pub usd: f64,
    pub budget: f64,
    /// Spend of this month per model id.
    #[serde(default)]
    pub by_model: BTreeMap<String, f64>,
}

pub struct Store {
    root: PathBuf,
    /// Serializes the read-modify-write of `index.json` and `usage.json`.
    lock: Mutex<()>,
}

const DEFAULT_BUDGET_USD: f64 = 100.0;

/// Chat ids are UUIDs made by the frontend; anything else could escape the
/// chats directory.
pub fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id.chars().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == '-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
}

fn current_month() -> String {
    chrono::Local::now().format("%Y-%m").to_string()
}

fn project_of(chat: &Value) -> Option<String> {
    chat.get("projectId")
        .and_then(Value::as_str)
        .filter(|id| valid_id(id))
        .map(str::to_string)
}

fn branch_of(chat: &Value) -> Option<String> {
    chat.get("branchOf")
        .and_then(Value::as_str)
        .filter(|id| valid_id(id))
        .map(str::to_string)
}

fn dir_of(chat: &Value) -> Option<String> {
    chat.get("projectDir")
        .and_then(Value::as_str)
        .map(|dir| dir.chars().take(1024).collect())
}

/// Bumped when the index gains a field; an older index is rebuilt once.
const INDEX_VERSION: &str = "3";

/// Chats are private: files only the user can read (0600).
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, bytes)
        .and_then(|()| fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600)))
        .and_then(|()| fs::rename(&tmp, path))
        .map_err(|_| "error.saveFailed".to_string())
}

impl Store {
    pub fn new(root: PathBuf) -> Self {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::create_dir_all(root.join("chats"));
        // Chats, transcripts and the engine's config live below; only the user may enter.
        let _ = fs::set_permissions(&root, fs::Permissions::from_mode(0o700));
        let store = Self {
            root,
            lock: Mutex::new(()),
        };
        store.upgrade_index();
        store
    }

    /// Rebuilds an index written by an older version, so every entry carries
    /// the fields of the current one.
    fn upgrade_index(&self) {
        let marker = self.root.join("chats").join("index.version");
        if fs::read_to_string(&marker).ok().as_deref() == Some(INDEX_VERSION) {
            return;
        }
        if self.index_path().exists() {
            self.rebuild_index();
        }
        let _ = fs::write(marker, INDEX_VERSION);
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn chat_path(&self, id: &str) -> PathBuf {
        self.root.join("chats").join(format!("{id}.json"))
    }

    fn index_path(&self) -> PathBuf {
        self.root.join("chats").join("index.json")
    }

    fn guard(&self) -> std::sync::MutexGuard<'_, ()> {
        self.lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn list(&self) -> Vec<ChatSummary> {
        let _guard = self.guard();
        self.read_index()
    }

    /// Reads the index, or rebuilds it from the chat files when it is
    /// missing or damaged, so no chat is ever orphaned.
    fn read_index(&self) -> Vec<ChatSummary> {
        let stored: Option<Vec<ChatSummary>> = fs::read(self.index_path())
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok());
        let mut list = stored.unwrap_or_else(|| self.rebuild_index());
        list.sort_by_key(|entry| Reverse(entry.updated_at));
        list
    }

    fn rebuild_index(&self) -> Vec<ChatSummary> {
        let Ok(entries) = fs::read_dir(self.root.join("chats")) else {
            return Vec::new();
        };
        let list: Vec<ChatSummary> = entries
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let name = entry.file_name().into_string().ok()?;
                let id = name.strip_suffix(".json").filter(|id| valid_id(id))?;
                let chat: Value = serde_json::from_slice(&fs::read(entry.path()).ok()?).ok()?;
                Some(ChatSummary {
                    id: id.to_string(),
                    title: chat
                        .get("title")
                        .and_then(Value::as_str)
                        .unwrap_or("Chat")
                        .to_string(),
                    pinned: chat.get("pinned").and_then(Value::as_bool).unwrap_or(false),
                    project_id: project_of(&chat),
                    project_dir: dir_of(&chat),
                    branch_of: branch_of(&chat),
                    updated_at: chat.get("updatedAt").and_then(Value::as_i64).unwrap_or(0),
                })
            })
            .collect();
        if !list.is_empty() {
            let _ = self.write_index(&list);
        }
        list
    }

    fn write_index(&self, list: &[ChatSummary]) -> Result<(), String> {
        let bytes = serde_json::to_vec(list).map_err(|_| "error.saveFailed".to_string())?;
        write_atomic(&self.index_path(), &bytes)
    }

    pub fn load(&self, id: &str) -> Result<Value, String> {
        if !valid_id(id) {
            return Err("error.unknownChat".into());
        }
        let bytes = fs::read(self.chat_path(id)).map_err(|_| "error.chatNotFound".to_string())?;
        serde_json::from_slice(&bytes).map_err(|_| "error.chatDamaged".into())
    }

    pub fn save(&self, chat: &Value) -> Result<(), String> {
        let id = chat.get("id").and_then(Value::as_str).unwrap_or_default();
        if !valid_id(id) {
            return Err("error.unknownChat".into());
        }
        let title: String = chat
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("Neuer Chat")
            .chars()
            .take(120)
            .collect();
        let updated_at = chat.get("updatedAt").and_then(Value::as_i64).unwrap_or(0);
        let bytes = serde_json::to_vec(chat).map_err(|_| "error.saveFailed".to_string())?;
        let _guard = self.guard();
        write_atomic(&self.chat_path(id), &bytes)?;

        let summary = ChatSummary {
            id: id.to_string(),
            title,
            updated_at,
            pinned: chat.get("pinned").and_then(Value::as_bool).unwrap_or(false),
            project_id: project_of(chat),
            project_dir: dir_of(chat),
            branch_of: branch_of(chat),
        };
        let mut list = self.read_index();
        // Most saves change only the chat itself; the index stays as it is.
        if list.contains(&summary) {
            return Ok(());
        }
        list.retain(|entry| entry.id != id);
        list.push(summary);
        self.write_index(&list)
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        if !valid_id(id) {
            return Err("error.unknownChat".into());
        }
        let _guard = self.guard();
        let chat = fs::read(self.chat_path(id))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
        // The chat's own session and those of second-model answers in it.
        let mut sessions: Vec<String> = Vec::new();
        if let Some(chat) = &chat {
            sessions.extend(
                chat.get("sessionId")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            );
            if let Some(messages) = chat.get("messages").and_then(Value::as_array) {
                sessions.extend(
                    messages
                        .iter()
                        .filter_map(|message| message.get("laneSession").and_then(Value::as_str))
                        .map(str::to_string),
                );
            }
        }
        // A branch that has not sent yet still continues one of these sessions.
        for session in sessions.iter().filter(|session| valid_id(session)) {
            if !self.referenced_unlocked(session, id) {
                self.delete_transcript(session);
            }
        }
        let _ = fs::remove_file(self.chat_path(id));
        let mut list = self.read_index();
        list.retain(|entry| entry.id != id);
        self.write_index(&list)
    }

    /// Whether another chat than `except` names this session, as a branch
    /// waiting to continue it does.
    pub fn session_referenced(&self, session: &str, except: &str) -> bool {
        let _guard = self.guard();
        self.referenced_unlocked(session, except)
    }

    fn referenced_unlocked(&self, session: &str, except: &str) -> bool {
        let Ok(entries) = fs::read_dir(self.root.join("chats")) else {
            return false;
        };
        entries.filter_map(Result::ok).any(|entry| {
            let path = entry.path();
            path.file_stem().and_then(|stem| stem.to_str()) != Some(except)
                && fs::read_to_string(&path).is_ok_and(|text| text.contains(session))
        })
    }

    /// The Agent SDK keeps its own copy of every conversation, attachments
    /// included. A deleted chat must not survive there.
    fn delete_transcript(&self, session: &str) {
        let Ok(projects) = fs::read_dir(self.root.join("claude-config").join("projects")) else {
            return;
        };
        for project in projects.filter_map(Result::ok) {
            let dir = project.path();
            let _ = fs::remove_file(dir.join(format!("{session}.jsonl")));
            let _ = fs::remove_dir_all(dir.join(session));
        }
    }

    fn projects_path(&self) -> PathBuf {
        self.root.join("projects.json")
    }

    fn read_projects(&self) -> Vec<Project> {
        fs::read(self.projects_path())
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    fn write_projects(&self, projects: &[Project]) -> Result<(), String> {
        let bytes = serde_json::to_vec(projects).map_err(|_| "error.saveFailed".to_string())?;
        write_atomic(&self.projects_path(), &bytes)
    }

    pub fn projects(&self) -> Vec<Project> {
        let _guard = self.guard();
        self.read_projects()
    }

    /// Adds a checked, canonical folder; a folder that is already a project
    /// returns the existing one.
    pub fn add_project(&self, id: &str, path: &Path) -> Result<Project, String> {
        if !valid_id(id) {
            return Err("error.invalidRequest".into());
        }
        let _guard = self.guard();
        let mut projects = self.read_projects();
        let path = path.display().to_string();
        if let Some(existing) = projects.iter().find(|project| project.path == path) {
            return Ok(existing.clone());
        }
        let name = Path::new(&path)
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone());
        let project = Project {
            id: id.to_string(),
            name,
            path,
            created_at: chrono::Local::now().timestamp_millis(),
            check: None,
        };
        projects.push(project.clone());
        self.write_projects(&projects)?;
        Ok(project)
    }

    pub fn rename_project(&self, id: &str, name: &str) -> Result<(), String> {
        let name: String = name.trim().chars().take(80).collect();
        if name.is_empty() {
            return Err("error.invalidRequest".into());
        }
        let _guard = self.guard();
        let mut projects = self.read_projects();
        let project = projects
            .iter_mut()
            .find(|project| project.id == id)
            .ok_or("error.invalidRequest")?;
        project.name = name;
        self.write_projects(&projects)
    }

    /// Sets the command run after Claude changed files; empty turns it off.
    pub fn set_project_check(&self, id: &str, check: &str) -> Result<(), String> {
        let check: String = check.trim().chars().take(500).collect();
        let _guard = self.guard();
        let mut projects = self.read_projects();
        let project = projects
            .iter_mut()
            .find(|project| project.id == id)
            .ok_or("error.invalidRequest")?;
        project.check = (!check.is_empty()).then_some(check);
        self.write_projects(&projects)
    }

    /// Removes a project from the list only; its folder and chats stay.
    pub fn remove_project(&self, id: &str) -> Result<(), String> {
        let _guard = self.guard();
        let mut projects = self.read_projects();
        projects.retain(|project| project.id != id);
        self.write_projects(&projects)
    }

    pub fn usage(&self) -> Usage {
        let _guard = self.guard();
        self.read_usage()
    }

    fn read_usage(&self) -> Usage {
        let stored: Option<Usage> = fs::read(self.root.join("usage.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok());
        let month = current_month();
        match stored {
            Some(usage) if usage.month == month => usage,
            Some(usage) => Usage {
                month,
                usd: 0.0,
                budget: usage.budget,
                by_model: BTreeMap::new(),
            },
            None => Usage {
                month,
                usd: 0.0,
                budget: DEFAULT_BUDGET_USD,
                by_model: BTreeMap::new(),
            },
        }
    }

    fn write_usage(&self, usage: &Usage) -> Result<(), String> {
        let bytes = serde_json::to_vec(usage).map_err(|_| "error.saveFailed".to_string())?;
        write_atomic(&self.root.join("usage.json"), &bytes)
    }

    pub fn add_cost(&self, usd: f64, model: &str) -> Usage {
        let _guard = self.guard();
        let mut usage = self.read_usage();
        if usd.is_finite() && usd > 0.0 {
            usage.usd += usd;
            *usage.by_model.entry(model.to_string()).or_default() += usd;
            let _ = self.write_usage(&usage);
        }
        usage
    }

    pub fn set_budget(&self, budget: f64) -> Result<Usage, String> {
        if !budget.is_finite() || !(1.0..=10_000.0).contains(&budget) {
            return Err("error.budgetRange".into());
        }
        let _guard = self.guard();
        let mut usage = self.read_usage();
        usage.budget = budget;
        self.write_usage(&usage)?;
        Ok(usage)
    }
}
