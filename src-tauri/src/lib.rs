mod engine;
mod keychain;
mod store;

use engine::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use store::{ChatSummary, Store, Usage};
use tauri::{AppHandle, Manager, RunEvent, State};

struct AppState {
    store: Arc<Store>,
    engine: Engine,
}

pub(crate) const MODELS: [&str; 3] = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"];
const EFFORTS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];
const MEDIA_TYPES: [&str; 5] = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "application/pdf",
];
/// The Messages API accepts requests up to 32 MB; leave room for the text.
const MAX_ATTACHMENT_BYTES: usize = 30 * 1024 * 1024;
const MAX_TEXT_CHARS: usize = 400_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Attachment {
    media_type: String,
    data: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendRequest {
    chat_id: String,
    session_id: Option<String>,
    model: String,
    effort: String,
    web: bool,
    text: String,
    attachments: Vec<Attachment>,
    cost_so_far: f64,
    /// Replace the last exchange: resume the session cut back to `rewind_to`.
    #[serde(default)]
    rewind: bool,
    rewind_to: Option<String>,
}

#[tauri::command]
fn key_status() -> bool {
    keychain::read().is_some()
}

// Disk, Keychain and process work stays off the main thread.
#[tauri::command(async)]
fn key_save(key: String, state: State<AppState>) -> Result<(), String> {
    keychain::save(&key)?;
    // The running engine still holds the old key.
    state.engine.stop();
    Ok(())
}

#[tauri::command(async)]
fn key_delete(state: State<AppState>) -> Result<(), String> {
    state.engine.stop();
    keychain::delete()
}

#[tauri::command(async)]
fn chats_list(state: State<AppState>) -> Vec<ChatSummary> {
    state.store.list()
}

#[tauri::command(async)]
fn chat_load(id: String, state: State<AppState>) -> Result<Value, String> {
    state.store.load(&id)
}

#[tauri::command(async)]
fn chat_save(chat: Value, state: State<AppState>) -> Result<(), String> {
    state.store.save(&chat)
}

#[tauri::command(async)]
fn chat_delete(id: String, state: State<AppState>) -> Result<(), String> {
    state
        .engine
        .notify(&json!({ "type": "close", "chatId": id }).to_string());
    state.store.delete(&id)
}

#[tauri::command]
fn usage_get(state: State<AppState>) -> Usage {
    state.store.usage()
}

#[tauri::command]
fn budget_set(usd: f64, state: State<AppState>) -> Result<Usage, String> {
    state.store.set_budget(usd)
}

#[tauri::command(async)]
fn chat_send(request: SendRequest, app: AppHandle, state: State<AppState>) -> Result<u64, String> {
    if !store::valid_id(&request.chat_id)
        || request
            .session_id
            .as_deref()
            .is_some_and(|id| !store::valid_id(id))
        || request
            .rewind_to
            .as_deref()
            .is_some_and(|id| !store::valid_id(id))
        || !MODELS.contains(&request.model.as_str())
        || !EFFORTS.contains(&request.effort.as_str())
    {
        return Err("Ungültige Anfrage.".into());
    }
    if request.text.chars().count() > MAX_TEXT_CHARS {
        return Err("Die Nachricht ist zu lang.".into());
    }
    if request.text.trim().is_empty() && request.attachments.is_empty() {
        return Err("Die Nachricht ist leer.".into());
    }
    if request
        .attachments
        .iter()
        .any(|file| !MEDIA_TYPES.contains(&file.media_type.as_str()))
    {
        return Err("Nur Bilder und PDFs können angehängt werden.".into());
    }
    if request
        .attachments
        .iter()
        .map(|file| file.data.len())
        .sum::<usize>()
        > MAX_ATTACHMENT_BYTES
    {
        return Err("Die Anhänge sind zusammen zu groß.".into());
    }
    let usage = state.store.usage();
    if usage.usd >= usage.budget {
        return Err("Das Monatsbudget ist aufgebraucht.".into());
    }

    let line = json!({
        "type": "send",
        "chatId": request.chat_id,
        "sessionId": request.session_id,
        "model": request.model,
        "effort": request.effort,
        "web": request.web,
        "text": request.text,
        "costSoFar": request.cost_so_far,
        "rewind": request.rewind,
        "rewindTo": request.rewind_to,
        "attachments": request.attachments.iter().map(|file| json!({
            "mediaType": file.media_type,
            "data": file.data,
        })).collect::<Vec<_>>(),
    })
    .to_string();
    state.engine.send(&app, &state.store, &line)
}

/// Asks the engine for a short title once a chat has its first answer.
#[tauri::command(async)]
fn chat_title(
    chat_id: String,
    text: String,
    app: AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    if !store::valid_id(&chat_id) {
        return Err("Unbekannter Chat.".into());
    }
    let usage = state.store.usage();
    if usage.usd >= usage.budget {
        return Ok(());
    }
    let text: String = text.chars().take(4000).collect();
    let line = json!({ "type": "title", "chatId": chat_id, "text": text }).to_string();
    state.engine.send(&app, &state.store, &line).map(|_| ())
}

#[tauri::command]
fn chat_stop(chat_id: String, state: State<AppState>) {
    if store::valid_id(&chat_id) {
        state
            .engine
            .notify(&json!({ "type": "interrupt", "chatId": chat_id }).to_string());
    }
}

/// The window may only show the app itself. A link in an answer that slips
/// past the click handler must not turn the window into a browser.
fn navigation_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(|_, url| {
            matches!(url.scheme(), "tauri" | "asset")
                || (url.host_str() == Some("localhost") && cfg!(debug_assertions))
                || url.host_str() == Some("tauri.localhost")
        })
        .build()
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(navigation_guard())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            app.manage(AppState {
                store: Arc::new(Store::new(root)),
                engine: Engine::default(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            key_status,
            key_save,
            key_delete,
            chats_list,
            chat_load,
            chat_save,
            chat_delete,
            usage_get,
            budget_set,
            chat_send,
            chat_title,
            chat_stop,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build the app");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<AppState>() {
                state.engine.stop();
            }
        }
    });
}
