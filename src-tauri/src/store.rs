//! Chats and the monthly spend, stored as JSON files in the app data dir.
//!
//! Every chat is one file `chats/<id>.json`; `chats/index.json` holds the
//! summaries so the sidebar never has to open every chat.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cmp::Reverse;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSummary {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub month: String,
    pub usd: f64,
    pub budget: f64,
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

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, bytes)
        .and_then(|()| fs::rename(&tmp, path))
        .map_err(|_| "Speichern fehlgeschlagen.".to_string())
}

impl Store {
    pub fn new(root: PathBuf) -> Self {
        let _ = fs::create_dir_all(root.join("chats"));
        Self {
            root,
            lock: Mutex::new(()),
        }
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
        let bytes =
            serde_json::to_vec(list).map_err(|_| "Speichern fehlgeschlagen.".to_string())?;
        write_atomic(&self.index_path(), &bytes)
    }

    pub fn load(&self, id: &str) -> Result<Value, String> {
        if !valid_id(id) {
            return Err("Unbekannter Chat.".into());
        }
        let bytes = fs::read(self.chat_path(id))
            .map_err(|_| "Der Chat wurde nicht gefunden.".to_string())?;
        serde_json::from_slice(&bytes).map_err(|_| "Der Chat ist beschädigt.".into())
    }

    pub fn save(&self, chat: &Value) -> Result<(), String> {
        let id = chat.get("id").and_then(Value::as_str).unwrap_or_default();
        if !valid_id(id) {
            return Err("Unbekannter Chat.".into());
        }
        let title: String = chat
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("Neuer Chat")
            .chars()
            .take(120)
            .collect();
        let updated_at = chat.get("updatedAt").and_then(Value::as_i64).unwrap_or(0);
        let bytes =
            serde_json::to_vec(chat).map_err(|_| "Speichern fehlgeschlagen.".to_string())?;
        let _guard = self.guard();
        write_atomic(&self.chat_path(id), &bytes)?;

        let mut list = self.read_index();
        list.retain(|entry| entry.id != id);
        list.push(ChatSummary {
            id: id.to_string(),
            title,
            updated_at,
        });
        self.write_index(&list)
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        if !valid_id(id) {
            return Err("Unbekannter Chat.".into());
        }
        let _guard = self.guard();
        let session = fs::read(self.chat_path(id))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .and_then(|chat| {
                chat.get("sessionId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            });
        if let Some(session) = session.filter(|session| valid_id(session)) {
            self.delete_transcript(&session);
        }
        let _ = fs::remove_file(self.chat_path(id));
        let mut list = self.read_index();
        list.retain(|entry| entry.id != id);
        self.write_index(&list)
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
            },
            None => Usage {
                month,
                usd: 0.0,
                budget: DEFAULT_BUDGET_USD,
            },
        }
    }

    fn write_usage(&self, usage: &Usage) -> Result<(), String> {
        let bytes =
            serde_json::to_vec(usage).map_err(|_| "Speichern fehlgeschlagen.".to_string())?;
        write_atomic(&self.root.join("usage.json"), &bytes)
    }

    pub fn add_cost(&self, usd: f64) -> Usage {
        let _guard = self.guard();
        let mut usage = self.read_usage();
        if usd.is_finite() && usd > 0.0 {
            usage.usd += usd;
            let _ = self.write_usage(&usage);
        }
        usage
    }

    pub fn set_budget(&self, budget: f64) -> Result<Usage, String> {
        if !budget.is_finite() || !(1.0..=10_000.0).contains(&budget) {
            return Err("Das Budget muss zwischen 1 und 10.000 $ liegen.".into());
        }
        let _guard = self.guard();
        let mut usage = self.read_usage();
        usage.budget = budget;
        self.write_usage(&usage)?;
        Ok(usage)
    }
}
