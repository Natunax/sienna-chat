mod engine;
mod keychain;
mod project;
mod store;

use engine::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use store::{ChatSummary, Project, Store, Usage};
use tauri::{AppHandle, Manager, RunEvent, State};

struct AppState {
    store: Arc<Store>,
    engine: Engine,
}

pub(crate) const MODELS: [&str; 4] = [
    "claude-haiku-5-5",
    "claude-sonnet-5-5",
    "claude-opus-5-5",
    "claude-fable-5-1",
];
const EFFORTS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];
/// Images and PDFs arrive as base64, text files (code, Markdown, CSV) as text.
const MEDIA_TYPES: [&str; 6] = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "application/pdf",
    TEXT_MEDIA_TYPE,
];
const TEXT_MEDIA_TYPE: &str = "text/plain";
/// The window allows 512 KB per text file; a little headroom for encoding.
const MAX_TEXT_FILE_BYTES: usize = 1024 * 1024;
/// The Messages API accepts requests up to 32 MB; leave room for the text.
const MAX_ATTACHMENT_BYTES: usize = 30 * 1024 * 1024;
const MAX_TEXT_CHARS: usize = 400_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Attachment {
    #[serde(default)]
    name: String,
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
    /// The project folder Claude works in for this chat.
    #[serde(default)]
    project_dir: Option<String>,
    /// File changes in the project run without asking first.
    #[serde(default)]
    auto_edits: bool,
}

/// The Mac's preferred language, for the window's own translations. Errors
/// returned by the commands are codes such as `error.noKey` that the window
/// translates as well.
#[tauri::command]
fn app_language() -> String {
    sys_locale::get_locale().unwrap_or_else(|| "en".into())
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
        return Err("error.invalidRequest".into());
    }
    if request.text.chars().count() > MAX_TEXT_CHARS {
        return Err("error.messageTooLong".into());
    }
    if request.text.trim().is_empty() && request.attachments.is_empty() {
        return Err("error.messageEmpty".into());
    }
    if request
        .attachments
        .iter()
        .any(|file| !MEDIA_TYPES.contains(&file.media_type.as_str()))
    {
        return Err("error.attachmentType".into());
    }
    if request
        .attachments
        .iter()
        .any(|file| file.media_type == TEXT_MEDIA_TYPE && file.data.len() > MAX_TEXT_FILE_BYTES)
    {
        return Err("error.attachmentsTooLarge".into());
    }
    if request
        .attachments
        .iter()
        .map(|file| file.data.len())
        .sum::<usize>()
        > MAX_ATTACHMENT_BYTES
    {
        return Err("error.attachmentsTooLarge".into());
    }
    let usage = state.store.usage();
    if usage.usd >= usage.budget {
        return Err("error.budgetReached".into());
    }

    let project_dir = request
        .project_dir
        .as_deref()
        .map(project::validate)
        .transpose()?
        .map(|dir| dir.display().to_string());

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
        "projectDir": project_dir,
        "autoEdits": request.auto_edits,
        "attachments": request.attachments.iter().map(|file| json!({
            "name": file.name.chars().take(200).collect::<String>(),
            "mediaType": file.media_type,
            "data": file.data,
        })).collect::<Vec<_>>(),
    })
    .to_string();
    state.engine.send(&app, &state.store, &line)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompactRequest {
    chat_id: String,
    session_id: Option<String>,
    model: String,
    effort: String,
    web: bool,
    cost_so_far: f64,
    #[serde(default)]
    project_dir: Option<String>,
}

/// Summarizes a chat's conversation so far to free context.
#[tauri::command(async)]
fn chat_compact(
    request: CompactRequest,
    app: AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    if !store::valid_id(&request.chat_id)
        || !request.session_id.as_deref().is_some_and(store::valid_id)
        || !MODELS.contains(&request.model.as_str())
        || !EFFORTS.contains(&request.effort.as_str())
    {
        return Err("error.invalidRequest".into());
    }
    let usage = state.store.usage();
    if usage.usd >= usage.budget {
        return Err("error.budgetReached".into());
    }
    let project_dir = request
        .project_dir
        .as_deref()
        .map(project::validate)
        .transpose()?
        .map(|dir| dir.display().to_string());
    let line = json!({
        "type": "compact",
        "chatId": request.chat_id,
        "sessionId": request.session_id,
        "model": request.model,
        "effort": request.effort,
        "web": request.web,
        "costSoFar": request.cost_so_far,
        "projectDir": project_dir,
    })
    .to_string();
    state.engine.send(&app, &state.store, &line).map(|_| ())
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
        return Err("error.unknownChat".into());
    }
    let usage = state.store.usage();
    if usage.usd >= usage.budget {
        return Ok(());
    }
    let text: String = text.chars().take(4000).collect();
    let line = json!({ "type": "title", "chatId": chat_id, "text": text }).to_string();
    state.engine.send(&app, &state.store, &line).map(|_| ())
}

#[tauri::command(async)]
fn projects_list(state: State<AppState>) -> Vec<Project> {
    state.store.projects()
}

/// Adds a folder as a project after the same checks a chat folder gets.
#[tauri::command(async)]
fn project_add(id: String, path: String, state: State<AppState>) -> Result<Project, String> {
    let dir = project::validate(&path)?;
    state.store.add_project(&id, &dir)
}

#[tauri::command(async)]
fn project_rename(id: String, name: String, state: State<AppState>) -> Result<(), String> {
    state.store.rename_project(&id, &name)
}

#[tauri::command(async)]
fn project_remove(id: String, state: State<AppState>) -> Result<(), String> {
    state.store.remove_project(&id)
}

/// Checks a folder picked as a chat's project and returns its canonical path.
#[tauri::command(async)]
fn project_check(path: String) -> Result<String, String> {
    project::validate(&path).map(|dir| dir.display().to_string())
}

#[tauri::command]
fn chat_stop(chat_id: String, state: State<AppState>) {
    if store::valid_id(&chat_id) {
        state
            .engine
            .notify(&json!({ "type": "interrupt", "chatId": chat_id }).to_string());
    }
}

/// Opens a file of a chat's project folder in the default text editor. Never
/// the file's default app: a `.command` file Claude wrote would run.
#[tauri::command(async)]
fn project_open_file(project_dir: String, path: String) -> Result<(), String> {
    let root = project::validate(&project_dir)?;
    let file = root
        .join(&path)
        .canonicalize()
        .map_err(|_| "error.fileMissing".to_string())?;
    if !file.starts_with(&root) || !file.is_file() {
        return Err("error.fileMissing".into());
    }
    std::process::Command::new("/usr/bin/open")
        .arg("-t")
        .arg(&file)
        .status()
        .map_err(|_| "error.fileMissing".to_string())
        .map(|_| ())
}

/// The user's answer to a change or command Claude asked to run.
#[tauri::command]
fn chat_permission(chat_id: String, id: String, decision: String, state: State<AppState>) {
    if store::valid_id(&chat_id)
        && store::valid_id(&id)
        && ["allow", "always", "deny"].contains(&decision.as_str())
    {
        state.engine.notify(
            &json!({ "type": "permission", "chatId": chat_id, "id": id, "decision": decision })
                .to_string(),
        );
    }
}

/// Lets file changes in a project chat run without asking, or asks again.
#[tauri::command]
fn chat_auto_edits(chat_id: String, on: bool, state: State<AppState>) {
    if store::valid_id(&chat_id) {
        state
            .engine
            .notify(&json!({ "type": "autoEdits", "chatId": chat_id, "on": on }).to_string());
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
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            app.manage(AppState {
                store: Arc::new(Store::new(root)),
                engine: Engine::default(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_language,
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
            chat_compact,
            project_check,
            projects_list,
            project_add,
            project_rename,
            project_remove,
            chat_stop,
            chat_permission,
            project_open_file,
            chat_auto_edits,
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
