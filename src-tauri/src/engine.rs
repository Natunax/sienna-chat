//! The chat engine: a Node process running `sidecar/index.mjs` with the
//! Claude Agent SDK. It starts on the first message, gets the API key from the
//! Keychain through its environment, and is stopped with the app.

use crate::{keychain, store::Store};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

struct Running {
    child: Child,
    stdin: ChildStdin,
    generation: u64,
}

/// Every engine process gets a generation number. Its events carry it, so the
/// window can tell a late `exit` of a replaced engine from one that matters.
#[derive(Default)]
pub struct Engine {
    running: Mutex<Option<Running>>,
    generations: AtomicU64,
}

fn retire(process: Option<Running>) {
    if let Some(mut process) = process {
        // Closing stdin lets the engine end its sessions; kill is the backstop.
        drop(process.stdin);
        let _ = process.child.kill();
        let _ = process.child.wait();
    }
}

/// GUI apps on macOS get a minimal PATH, so Node is looked up in the usual
/// install locations.
fn find_node() -> Option<PathBuf> {
    let home = std::env::var("HOME").unwrap_or_default();
    [
        "/opt/homebrew/bin/node".to_string(),
        "/usr/local/bin/node".to_string(),
        format!("{home}/.volta/bin/node"),
        format!("{home}/.local/bin/node"),
    ]
    .into_iter()
    .map(PathBuf::from)
    .find(|path| path.is_file())
}

/// The engine script and, in the packaged app, the Claude Code binary next to
/// it. Development runs the unbundled script, whose SDK finds the binary in
/// `node_modules` itself.
fn find_engine(app: &AppHandle) -> Option<(PathBuf, Option<PathBuf>)> {
    if cfg!(debug_assertions) {
        let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("../sidecar/index.mjs");
        if dev.is_file() {
            return Some((dev, None));
        }
    }
    let dir = app.path().resource_dir().ok()?.join("sidecar");
    let (script, binary) = (dir.join("engine.mjs"), dir.join("claude"));
    (script.is_file() && binary.is_file()).then_some((script, Some(binary)))
}

/// The helper that renders an artifact for its model to look at (`snapshot/`):
/// next to the app binary, or in `binaries/` while developing.
fn snapshot_helper() -> Option<PathBuf> {
    let bundled = std::env::current_exe()
        .ok()?
        .parent()?
        .join("sienna-snapshot");
    if bundled.is_file() {
        return Some(bundled);
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(concat!("sienna-snapshot-", env!("TARGET_TRIPLE")));
    (cfg!(debug_assertions) && dev.is_file()).then_some(dev)
}

fn spawn(app: &AppHandle, store: Arc<Store>, generation: u64) -> Result<Running, String> {
    let key = keychain::read().ok_or("error.noKey")?;
    let node = find_node().ok_or("error.nodeMissing")?;
    let (script, binary) = find_engine(app).ok_or("error.engineMissing")?;
    let node_dir = node
        .parent()
        .map(|dir| dir.display().to_string())
        .unwrap_or_default();

    let mut child = Command::new(&node)
        .arg(&script)
        .env_clear()
        .env("PATH", format!("{node_dir}:/usr/bin:/bin:/usr/sbin:/sbin"))
        .env("HOME", std::env::var("HOME").unwrap_or_default())
        .env("TMPDIR", std::env::temp_dir())
        .env("LANG", "de_DE.UTF-8")
        .env("ANTHROPIC_API_KEY", key)
        .env("CHAT_DATA_DIR", store.root())
        .env("SIENNA_CLAUDE_BIN", binary.unwrap_or_default())
        .env("SIENNA_SNAPSHOT_BIN", snapshot_helper().unwrap_or_default())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "error.engineStart".to_string())?;

    let stdin = child.stdin.take().ok_or("error.engineNoResponse")?;
    let stdout = child.stdout.take().ok_or("error.engineNoResponse")?;
    let app = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let Ok(Value::Object(mut event)) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            event.insert("generation".into(), generation.into());
            // Answers and generated titles both cost money.
            if let Some(cost) = event.get("costUsd").and_then(Value::as_f64) {
                let model = event.get("model").and_then(Value::as_str).unwrap_or("");
                let model = if crate::MODELS.contains(&model) {
                    model
                } else {
                    "other"
                };
                let _ = app.emit("usage", store.add_cost(cost, model));
            }
            let _ = app.emit("engine", event);
        }
        let _ = app.emit(
            "engine",
            serde_json::json!({ "type": "exit", "generation": generation }),
        );
    });
    Ok(Running {
        child,
        stdin,
        generation,
    })
}

impl Engine {
    /// Sends a command, starting the engine if needed; returns the generation
    /// of the engine that received it.
    pub fn send(&self, app: &AppHandle, store: &Arc<Store>, line: &str) -> Result<u64, String> {
        let mut running = self.running.lock().map_err(|_| "error.engineBlocked")?;
        let alive = running
            .as_mut()
            .is_some_and(|r| matches!(r.child.try_wait(), Ok(None)));
        if !alive {
            retire(running.take());
            let generation = self.generations.fetch_add(1, Ordering::Relaxed) + 1;
            *running = Some(spawn(app, store.clone(), generation)?);
        }
        let process = running.as_mut().expect("engine was just started");
        if writeln!(process.stdin, "{line}")
            .and_then(|()| process.stdin.flush())
            .is_err()
        {
            retire(running.take());
            return Err("error.engineStopped".into());
        }
        Ok(process.generation)
    }

    /// Writes a command only when the engine runs; nothing to cancel otherwise.
    pub fn notify(&self, line: &str) {
        if let Ok(mut running) = self.running.lock() {
            if let Some(process) = running.as_mut() {
                let _ = writeln!(process.stdin, "{line}").and_then(|()| process.stdin.flush());
            }
        }
    }

    pub fn stop(&self) {
        if let Ok(mut running) = self.running.lock() {
            retire(running.take());
        }
    }
}
