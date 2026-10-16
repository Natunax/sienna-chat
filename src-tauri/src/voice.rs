//! Dictation: the `sienna-voice` helper next to the app binary recognizes
//! speech on this Mac only (`voice/main.swift`). It runs while the user
//! dictates, in its own process without the API key, and its events reach the
//! main window only after they were checked here.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// The languages the window offers, and the locale the helper gets for each.
const LOCALES: [(&str, &str); 2] = [("de", "de-DE"), ("en", "en-US")];
/// Five minutes of speech stay well below this; anything longer is cut.
const MAX_TEXT_CHARS: usize = 20_000;
const ERRORS: [&str; 7] = [
    "micDenied",
    "speechDenied",
    "onDevice",
    "unsupported",
    "unavailable",
    "noMicrophone",
    "failed",
];

struct Running {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub struct Voice {
    running: Mutex<Option<Running>>,
    generations: AtomicU64,
}

fn helper() -> Option<PathBuf> {
    let path = std::env::current_exe().ok()?.parent()?.join("sienna-voice");
    path.is_file().then_some(path)
}

fn end(process: Option<Running>) {
    if let Some(mut process) = process {
        drop(process.stdin);
        let _ = process.child.kill();
        let _ = process.child.wait();
    }
}

/// Passes on a known event with checked fields; drops anything else.
fn checked(line: &str) -> Option<Value> {
    let event: Value = serde_json::from_str(line).ok()?;
    let kind = event.get("type")?.as_str()?;
    Some(match kind {
        "ready" | "limit" | "end" => json!({ "type": kind }),
        "level" => {
            let value = event.get("value")?.as_f64()?;
            json!({ "type": kind, "value": value.clamp(0.0, 1.0) })
        }
        "partial" | "final" => {
            let text: String = event
                .get("text")?
                .as_str()?
                .chars()
                .filter(|c| !c.is_control() || *c == '\n')
                .take(MAX_TEXT_CHARS)
                .collect();
            json!({ "type": kind, "text": text })
        }
        "error" => {
            let code = event.get("code")?.as_str()?;
            json!({ "type": kind, "code": if ERRORS.contains(&code) { code } else { "failed" } })
        }
        _ => return None,
    })
}

impl Voice {
    /// Starts listening; returns the number that the run's events carry.
    pub fn start(&self, app: &AppHandle, language: &str) -> Result<u64, String> {
        let locale = LOCALES
            .iter()
            .find(|(code, _)| *code == language)
            .map(|(_, locale)| *locale)
            .ok_or("error.invalidRequest")?;
        let path = helper().ok_or("voice.missing")?;
        let mut running = self.running.lock().map_err(|_| "voice.failed")?;
        end(running.take());

        let mut child = Command::new(path)
            .arg(locale)
            .env_clear()
            .env("HOME", std::env::var("HOME").unwrap_or_default())
            .env("TMPDIR", std::env::temp_dir())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "voice.failed".to_string())?;
        let stdin = child.stdin.take().ok_or("voice.failed")?;
        let stdout = child.stdout.take().ok_or("voice.failed")?;
        let generation = self.generations.fetch_add(1, Ordering::Relaxed) + 1;

        let app = app.clone();
        std::thread::spawn(move || {
            let mut closed = false;
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let Some(mut event) = checked(&line) else {
                    continue;
                };
                closed |= matches!(event["type"].as_str(), Some("end" | "error"));
                event["generation"] = generation.into();
                let _ = app.emit_to("main", "voice", event);
            }
            // The helper ended without a word, e.g. stopped by macOS.
            if !closed {
                let _ = app.emit_to(
                    "main",
                    "voice",
                    json!({ "type": "error", "code": "failed", "generation": generation }),
                );
            }
        });
        *running = Some(Running { child, stdin });
        Ok(generation)
    }

    /// Ends the microphone; the helper still sends the last words, then ends.
    pub fn stop(&self) {
        if let Ok(mut running) = self.running.lock() {
            if let Some(process) = running.as_mut() {
                let sent = writeln!(process.stdin, "stop").and_then(|()| process.stdin.flush());
                if sent.is_err() {
                    end(running.take());
                }
            }
        }
    }

    /// Ends at once and drops what was not sent yet.
    pub fn cancel(&self) {
        if let Ok(mut running) = self.running.lock() {
            end(running.take());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::checked;

    #[test]
    fn passes_only_known_events_with_checked_fields() {
        assert_eq!(
            checked(r#"{"type":"level","value":7}"#).unwrap()["value"],
            1.0
        );
        assert_eq!(
            checked(r#"{"type":"partial","text":"hi\u0007 there"}"#).unwrap()["text"],
            "hi there"
        );
        assert_eq!(
            checked(r#"{"type":"error","code":"<b>"}"#).unwrap()["code"],
            "failed"
        );
        assert!(checked(r#"{"type":"send","text":"rm -rf"}"#).is_none());
        assert!(checked("not json").is_none());
    }
}
