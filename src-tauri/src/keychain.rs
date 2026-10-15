//! The Anthropic API key lives in the macOS Keychain, never in a file.
//!
//! Every Keychain read can make macOS ask for permission, so the key is read
//! once per app run and then kept in memory.

use keyring::Entry;
use std::sync::Mutex;

static CACHED: Mutex<Option<String>> = Mutex::new(None);

fn set_cached(key: Option<String>) {
    *CACHED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = key;
}

const SERVICE: &str = "sienna";
const ACCOUNT: &str = "anthropic-api-key";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|_| "error.keychainUnavailable".to_string())
}

pub fn read() -> Option<String> {
    let mut cached = CACHED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if cached.is_none() {
        // A refused or missing key is not cached, so the next use asks again.
        *cached = entry()
            .ok()?
            .get_password()
            .ok()
            .filter(|key| !key.is_empty());
    }
    cached.clone()
}

pub fn save(key: &str) -> Result<(), String> {
    let key = key.trim();
    // API keys come in several prefixes (`sk-ant-api…`, `sk-ant-usr…`). An
    // OAuth token (`sk-ant-oat…`) would bill a subscription and an admin key
    // cannot chat, so those two are refused.
    let refused = key.starts_with("sk-ant-oat") || key.starts_with("sk-ant-admin");
    let plausible = key.starts_with("sk-ant-")
        && !refused
        && key.len() >= 40
        && key.len() <= 256
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !plausible {
        return Err("error.keyFormat".into());
    }
    entry()?
        .set_password(key)
        .map_err(|_| "error.keySave".to_string())?;
    set_cached(Some(key.to_string()));
    Ok(())
}

pub fn delete() -> Result<(), String> {
    set_cached(None);
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("error.keyDelete".into()),
    }
}
