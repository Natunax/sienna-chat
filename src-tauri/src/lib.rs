mod artifact;
mod engine;
mod keychain;
mod mention;
mod project;
mod store;
mod voice;
mod workcopy;

use engine::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use store::{ChatSummary, Project, Store, Usage};
use tauri::{AppHandle, Manager, RunEvent, State};
use voice::Voice;

struct AppState {
    store: Arc<Store>,
    engine: Engine,
    voice: Voice,
    artifacts: artifact::Artifacts,
}

pub(crate) const MODELS: [&str; 4] = [
    "claude-haiku-5-5",
    "claude-sonnet-5-5",
    "claude-opus-5-5",
    "claude-fable-5-1",
];
const EFFORTS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];
/// The permission modes of a project chat, as in Claude Code.
/// `readonly` is internal: a second model's answer next to the chat's own.
const MODES: [&str; 6] = [
    "auto",
    "default",
    "acceptEdits",
    "plan",
    "bypassPermissions",
    "readonly",
];
/// Answer formats of the templates (`sidecar/templates.mjs`).
const FORMATS: [&str; 3] = ["changelog", "review", "tasks"];
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
    /// How far Claude may go without asking in a project chat (see MODES).
    #[serde(default = "default_mode")]
    mode: String,
    /// Continue a copy of `session_id` from `rewind_to`, leaving it intact (a branch).
    #[serde(default)]
    fork: bool,
    /// A second model's answer: its session closes once the answer is done.
    #[serde(default)]
    lane: bool,
    /// The project's command to run after Claude changed files.
    #[serde(default)]
    check: Option<String>,
    /// A template's answer format.
    #[serde(default)]
    format: Option<String>,
    /// The window's id of this user message, for file checkpoints.
    #[serde(default)]
    user_uuid: Option<String>,
    /// The user reverted file changes since the last message.
    #[serde(default)]
    reverted: bool,
    /// The setting "approve automatically" (`auto_approve`).
    #[serde(default)]
    auto_approve: bool,
}

fn default_mode() -> String {
    "auto".into()
}

/// The Mac's preferred language, for the window's own translations. Errors
/// returned by the commands are codes such as `error.noKey` that the window
/// translates as well.
#[tauri::command]
fn app_language() -> String {
    sys_locale::get_locale().unwrap_or_else(|| "en".into())
}

#[tauri::command(async)]
fn key_status() -> bool {
    keychain::read().is_some()
}

// Disk, Keychain and process work stays off the main thread, and so do
// commands that wait for the engine lock (it is held while the engine starts).
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
        || !MODES.contains(&request.mode.as_str())
    {
        return Err("error.invalidRequest".into());
    }
    if request
        .user_uuid
        .as_deref()
        .is_some_and(|id| !store::valid_id(id))
        || request
            .format
            .as_deref()
            .is_some_and(|format| !FORMATS.contains(&format))
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

    let project_root = request
        .project_dir
        .as_deref()
        .map(project::validate)
        .transpose()?;
    // `@path` mentions bring the file or folder along; the window keeps the text as typed.
    let text = match project_root
        .as_deref()
        .and_then(|root| mention::context(root, &request.text))
    {
        Some(context) => format!("{}\n\n{context}", request.text),
        None => request.text.clone(),
    };
    let project_dir = project_root.map(|dir| dir.display().to_string());

    let line = json!({
        "type": "send",
        "chatId": request.chat_id,
        "sessionId": request.session_id,
        "model": request.model,
        "effort": request.effort,
        "web": request.web,
        "text": text,
        "costSoFar": request.cost_so_far,
        "rewind": request.rewind,
        "rewindTo": request.rewind_to,
        // A branch still waiting for its first message continues this session.
        "keepReplaced": request.rewind
            && request
                .session_id
                .as_deref()
                .is_some_and(|session| state.store.session_referenced(session, &request.chat_id)),
        "projectDir": project_dir,
        "mode": request.mode,
        "fork": request.fork,
        "lane": request.lane,
        "autoApprove": request.auto_approve,
        "check": request.check.as_deref().map(|check| check.chars().take(500).collect::<String>()),
        "format": request.format,
        "userUuid": request.user_uuid,
        "reverted": request.reverted,
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
    #[serde(default = "default_mode")]
    mode: String,
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
        || !MODES.contains(&request.mode.as_str())
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
        "mode": request.mode,
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

#[tauri::command(async)]
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
#[tauri::command(async)]
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RevertRequest {
    chat_id: String,
    session_id: String,
    message_id: String,
    model: String,
    effort: String,
    web: bool,
    project_dir: String,
    mode: String,
    #[serde(default)]
    cost_so_far: f64,
}

/// Undoes the file changes Claude made since a user message (file checkpoints).
#[tauri::command(async)]
fn chat_revert_files(
    request: RevertRequest,
    app: AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    if !store::valid_id(&request.chat_id)
        || !store::valid_id(&request.session_id)
        || !store::valid_id(&request.message_id)
        || !MODELS.contains(&request.model.as_str())
        || !EFFORTS.contains(&request.effort.as_str())
        || !MODES.contains(&request.mode.as_str())
    {
        return Err("error.invalidRequest".into());
    }
    let project_dir = project::validate(&request.project_dir)?;
    let line = json!({
        "type": "rewindFiles",
        "chatId": request.chat_id,
        "sessionId": request.session_id,
        "messageId": request.message_id,
        "model": request.model,
        "effort": request.effort,
        "web": request.web,
        "projectDir": project_dir.display().to_string(),
        "mode": request.mode,
        "costSoFar": request.cost_so_far,
    })
    .to_string();
    state.engine.send(&app, &state.store, &line).map(|_| ())
}

#[tauri::command(async)]
fn project_set_check(id: String, check: String, state: State<AppState>) -> Result<(), String> {
    state.store.set_project_check(&id, &check)
}

/// The files and folders `@` can mention in a project chat.
#[tauri::command(async)]
fn project_files(path: String) -> Result<Vec<mention::Entry>, String> {
    Ok(mention::list(&project::validate(&path)?))
}

/// Suggests a check command from the files in a project folder.
#[tauri::command(async)]
fn project_guess_check(path: String) -> Result<String, String> {
    let dir = project::validate(&path)?;
    let has = |name: &str| dir.join(name).is_file();
    // `npm init` writes a test script that only fails; that is no check.
    let package_test = std::fs::read_to_string(dir.join("package.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|package| {
            package
                .pointer("/scripts/test")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .is_some_and(|script| !script.contains("no test specified"));
    let make_test = std::fs::read_to_string(dir.join("Makefile"))
        .is_ok_and(|text| text.lines().any(|line| line.starts_with("test:")));
    let guess = if package_test {
        "npm test"
    } else if has("Cargo.toml") {
        "cargo test"
    } else if has("go.mod") {
        "go test ./..."
    } else if has("pyproject.toml") || has("pytest.ini") {
        "pytest"
    } else if make_test {
        "make test"
    } else {
        ""
    };
    Ok(guess.into())
}

/// The setting "approve automatically", on top of every mode; waiting
/// approvals it covers are answered at once.
#[tauri::command(async)]
fn auto_approve(on: bool, state: State<AppState>) {
    state
        .engine
        .notify(&json!({ "type": "autoApprove", "on": on }).to_string());
}

/// Switches a project chat's mode, also while an answer runs.
#[tauri::command(async)]
fn chat_mode(chat_id: String, mode: String, state: State<AppState>) {
    if store::valid_id(&chat_id) && MODES.contains(&mode.as_str()) {
        state
            .engine
            .notify(&json!({ "type": "mode", "chatId": chat_id, "mode": mode }).to_string());
    }
}

/// Starts dictation in `de` or `en`; the text arrives as `voice` events.
#[tauri::command(async)]
fn voice_start(language: String, app: AppHandle, state: State<AppState>) -> Result<u64, String> {
    state.voice.start(&app, &language)
}

/// Ends the microphone; the last words still arrive.
#[tauri::command(async)]
fn voice_stop(state: State<AppState>) {
    state.voice.stop();
}

/// Ends dictation at once.
#[tauri::command(async)]
fn voice_cancel(state: State<AppState>) {
    state.voice.cancel();
}

/// Keeps an HTML or SVG artifact for its sealed frame; returns its address token.
#[tauri::command(async)]
fn artifact_stage(kind: String, content: String, state: State<AppState>) -> Result<String, String> {
    state.artifacts.stage(&kind, &content)
}

/// Saves an artifact where the user picks in the save dialog. The path comes
/// from the dialog, never from the window.
#[tauri::command(async)]
fn artifact_save(
    id: String,
    kind: String,
    language: Option<String>,
    content: String,
    app: AppHandle,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    if !["html", "svg", "markdown", "code"].contains(&kind.as_str()) {
        return Err("error.invalidRequest".into());
    }
    let name = artifact::file_name(&id, &kind, language.as_deref().unwrap_or(""));
    let Some(path) = app
        .dialog()
        .file()
        .set_file_name(&name)
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = path
        .into_path()
        .map_err(|_| "error.saveFailed".to_string())?;
    std::fs::write(path, content).map_err(|_| "error.saveFailed".to_string())?;
    Ok(true)
}

/// A working copy of a project for a second model's answer; returns its folder.
#[tauri::command(async)]
fn workcopy_create(project_dir: String) -> Result<String, String> {
    let project = project::validate(&project_dir)?;
    if workcopy::is_work(&project) {
        return Err("error.projectInvalid".into());
    }
    workcopy::create(&project).map(|work| work.display().to_string())
}

/// The files a working copy changed, added or deleted.
#[tauri::command(async)]
fn workcopy_changes(work: String) -> Result<Vec<workcopy::Change>, String> {
    workcopy::changes(&work)
}

/// Takes a working copy's changes over into the project. The copy stays while
/// files are left out, so the user can still replace them (`force`).
#[tauri::command(async)]
fn workcopy_apply(
    work: String,
    project_dir: String,
    force: Option<Vec<String>>,
) -> Result<workcopy::Applied, String> {
    let project = project::validate(&project_dir)?;
    if workcopy::is_work(&project) {
        return Err("error.projectInvalid".into());
    }
    let result = workcopy::apply(&work, &project, &force.unwrap_or_default())?;
    if result.conflicts_empty() {
        let _ = workcopy::discard(&work);
    }
    Ok(result)
}

#[tauri::command(async)]
fn workcopy_discard(work: String) -> Result<(), String> {
    workcopy::discard(&work)
}

/// The window may only show the app itself. A link in an answer that slips
/// past the click handler must not turn the window into a browser.
fn navigation_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(|_, url| {
            // `artifact:` is the sealed frame next to the chat.
            matches!(url.scheme(), "tauri" | "asset" | "artifact")
                || (url.host_str() == Some("localhost") && cfg!(debug_assertions))
                || url.host_str() == Some("tauri.localhost")
        })
        .build()
}

/// Typed text stays as typed: macOS would otherwise turn quotes into
/// typographic ones, `--` into a dash and apply text replacements in the
/// window's fields, which breaks code written for Claude. WebKit reads these
/// app preferences when the window's text fields are created.
#[cfg(target_os = "macos")]
fn plain_typing() {
    use std::ffi::{c_char, c_void, CString};
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFBooleanFalse: *const c_void;
        static kCFPreferencesCurrentApplication: *const c_void;
        fn CFStringCreateWithCString(
            alloc: *const c_void,
            text: *const c_char,
            encoding: u32,
        ) -> *const c_void;
        fn CFPreferencesSetAppValue(key: *const c_void, value: *const c_void, app: *const c_void);
        fn CFPreferencesAppSynchronize(app: *const c_void) -> u8;
        fn CFRelease(object: *const c_void);
    }
    const UTF8: u32 = 0x0800_0100;
    for key in [
        "WebAutomaticQuoteSubstitutionEnabled",
        "WebAutomaticDashSubstitutionEnabled",
        "WebAutomaticTextReplacementEnabled",
        "WebAutomaticSpellingCorrectionEnabled",
    ] {
        let Ok(name) = CString::new(key) else {
            continue;
        };
        // SAFETY: plain CoreFoundation calls with valid, released CFStrings.
        unsafe {
            let key = CFStringCreateWithCString(std::ptr::null(), name.as_ptr(), UTF8);
            if key.is_null() {
                continue;
            }
            CFPreferencesSetAppValue(key, kCFBooleanFalse, kCFPreferencesCurrentApplication);
            CFRelease(key);
        }
    }
    // SAFETY: as above.
    unsafe {
        CFPreferencesAppSynchronize(kCFPreferencesCurrentApplication);
    }
}

pub fn run() {
    #[cfg(target_os = "macos")]
    plain_typing();
    let app = tauri::Builder::default()
        .plugin(navigation_guard())
        .register_uri_scheme_protocol("artifact", |context, request| {
            match context.app_handle().try_state::<AppState>() {
                Some(state) => state.artifacts.serve(request.uri().path()),
                None => tauri::http::Response::new(Vec::new()),
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            workcopy::init(app.path().app_cache_dir()?);
            app.manage(AppState {
                store: Arc::new(Store::new(root)),
                engine: Engine::default(),
                voice: Voice::default(),
                artifacts: artifact::Artifacts::default(),
            });
            Ok(())
        })
        // A reload of the window never leaves the microphone on.
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                if let Some(state) = webview.try_state::<AppState>() {
                    state.voice.cancel();
                }
            }
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
            chat_mode,
            chat_revert_files,
            project_set_check,
            project_guess_check,
            project_files,
            auto_approve,
            artifact_stage,
            workcopy_create,
            workcopy_changes,
            workcopy_apply,
            workcopy_discard,
            artifact_save,
            voice_start,
            voice_stop,
            voice_cancel,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build the app");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<AppState>() {
                state.engine.stop();
                state.voice.cancel();
            }
        }
    });
}
