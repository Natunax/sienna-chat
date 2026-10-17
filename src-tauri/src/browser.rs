//! The browser in a chat's side panel: a native child webview inside the main
//! window, laid over a placeholder the panel keeps in place.
//!
//! It is a stranger to the app: its label is in no capability, remote pages
//! never reach the app's commands (Tauri refuses remote origins without a
//! `remote` capability), it opens only http and https, keeps nothing between
//! runs (non-persistent store), opens no windows and downloads nothing. The
//! sealed `artifact:` scheme answers only the main webview (`lib.rs`).

use serde::Serialize;
use std::sync::OnceLock;
use tauri::webview::{NewWindowResponse, PageLoadEvent, PermissionResponse, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Url, WebviewUrl};

pub const LABEL: &str = "browser";

/// While developing, the app itself is served from this host and port
/// (`devUrl`), and Tauri treats pages from there as its own.
static DEV_ORIGIN: OnceLock<Option<(String, u16)>> = OnceLock::new();

/// Remembers the app's dev origin; call once at startup.
pub fn init(app: &AppHandle) {
    let origin = if cfg!(debug_assertions) {
        app.config()
            .build
            .dev_url
            .as_ref()
            .and_then(|url| Some((url.host_str()?.to_string(), url.port_or_known_default()?)))
    } else {
        None
    };
    let _ = DEV_ORIGIN.set(origin);
}

fn is_local_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "[::1]") || host.ends_with(".localhost")
}

/// Media play on in a hidden page otherwise; pausing is all a page gets told.
const PAUSE_MEDIA: &str =
    "document.querySelectorAll('video,audio').forEach(function(m){try{m.pause()}catch(e){}})";

#[derive(Clone, Serialize)]
struct Navigation {
    url: String,
    loading: bool,
}

/// Web pages only, and never the app's own pages or the sealed artifacts.
pub fn allowed(url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    // The app's own dev server, on any name for this machine.
    let port = url.port_or_known_default();
    let own_dev = match DEV_ORIGIN.get() {
        Some(Some((_, dev_port))) => is_local_host(host) && port == Some(*dev_port),
        // Unknown before startup: stay on the safe side in a debug build.
        None => cfg!(debug_assertions) && is_local_host(host) && port == Some(1430),
        Some(None) => false,
    };
    !own_dev && host != "tauri.localhost" && host != "artifact.localhost"
}

fn web_url(url: &str) -> Result<Url, String> {
    let url = Url::parse(url).map_err(|_| "error.invalidUrl".to_string())?;
    if allowed(&url) {
        Ok(url)
    } else {
        Err("error.invalidUrl".into())
    }
}

fn bounds(x: f64, y: f64, width: f64, height: f64) -> Rect {
    Rect {
        position: LogicalPosition::new(x.max(0.0), y.max(0.0)).into(),
        size: LogicalSize::new(width.max(1.0), height.max(1.0)).into(),
    }
}

/// Opens a page, creating the browser over the given area the first time.
pub fn open(
    app: &AppHandle,
    url: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let url = web_url(url)?;
    if let Some(webview) = app.get_webview(LABEL) {
        webview
            .set_bounds(bounds(x, y, width, height))
            .map_err(|e| e.to_string())?;
        webview.show().map_err(|e| e.to_string())?;
        return webview.navigate(url).map_err(|e| e.to_string());
    }
    let window = app.get_window("main").ok_or("error.noWindow")?;
    let loads = app.clone();
    let titles = app.clone();
    let popups = app.clone();
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(url))
        .incognito(true)
        .on_navigation(allowed)
        // A link that wants a new window opens here instead.
        .on_new_window(move |url, _| {
            if allowed(&url) {
                if let Some(webview) = popups.get_webview(LABEL) {
                    let _ = webview.navigate(url);
                }
            }
            NewWindowResponse::Deny
        })
        .on_download(|_, _| false)
        // No microphone, camera, location or notifications for web pages:
        // the app holds the microphone for dictation, a page must not inherit it.
        .on_permission_request(|_, _| PermissionResponse::Deny)
        .on_document_title_changed(move |_, title| {
            let _ = titles.emit_to("main", "browser-title", title);
        })
        .on_page_load(move |_, payload| {
            let _ = loads.emit_to(
                "main",
                "browser-nav",
                Navigation {
                    url: payload.url().to_string(),
                    loading: payload.event() == PageLoadEvent::Started,
                },
            );
        });
    let rect = bounds(x, y, width, height);
    window
        .add_child(builder, rect.position, rect.size)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn set_bounds(app: &AppHandle, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    match app.get_webview(LABEL) {
        Some(webview) => webview
            .set_bounds(bounds(x, y, width, height))
            .map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

pub fn set_visible(app: &AppHandle, visible: bool) -> Result<(), String> {
    match app.get_webview(LABEL) {
        Some(webview) if visible => webview.show().map_err(|e| e.to_string()),
        Some(webview) => {
            let _ = webview.eval(PAUSE_MEDIA);
            webview.hide().map_err(|e| e.to_string())
        }
        None => Ok(()),
    }
}

/// Back, forward, reload or stop, as the page's own history knows them.
pub fn go(app: &AppHandle, action: &str) -> Result<(), String> {
    let Some(webview) = app.get_webview(LABEL) else {
        return Ok(());
    };
    match action {
        "back" => webview.eval("history.back()"),
        "forward" => webview.eval("history.forward()"),
        "reload" => webview.reload(),
        "stop" => webview.eval("window.stop()"),
        _ => return Err("error.invalidAction".into()),
    }
    .map_err(|e| e.to_string())
}

pub fn close(app: &AppHandle) -> Result<(), String> {
    match app.get_webview(LABEL) {
        Some(webview) => webview.close().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(url: &str) -> bool {
        allowed(&Url::parse(url).unwrap())
    }

    #[test]
    fn opens_only_web_pages() {
        assert!(ok("https://example.com/path?q=1"));
        assert!(ok("http://localhost:3000/"));
        assert!(!ok("file:///etc/passwd"));
        assert!(!ok("artifact://localhost/abc"));
        assert!(!ok("tauri://localhost/"));
        assert!(!ok("javascript:alert(1)"));
        assert!(!ok("data:text/html,hi"));
        assert!(!ok("https://tauri.localhost/"));
        assert!(!ok("http://artifact.localhost/x"));
    }

    #[test]
    fn never_the_apps_dev_server() {
        // Before `init`, a debug build keeps the configured dev port out.
        assert_eq!(ok("http://localhost:1430/"), !cfg!(debug_assertions));
        assert_eq!(ok("http://127.0.0.1:1430/"), !cfg!(debug_assertions));
        assert!(ok("http://localhost:5173/"));
    }
}
