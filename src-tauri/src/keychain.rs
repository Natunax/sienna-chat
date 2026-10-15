//! The Anthropic API key lives in the macOS Keychain, never in a file.

use keyring::Entry;

const SERVICE: &str = "sienna";
const ACCOUNT: &str = "anthropic-api-key";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|_| "Der Schlüsselbund ist nicht erreichbar.".to_string())
}

pub fn read() -> Option<String> {
    entry()
        .ok()?
        .get_password()
        .ok()
        .filter(|key| !key.is_empty())
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
        return Err("Das sieht nicht wie ein Anthropic-API-Key aus.".into());
    }
    entry()?
        .set_password(key)
        .map_err(|_| "Der Key konnte nicht im Schlüsselbund gespeichert werden.".into())
}

pub fn delete() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Der Key konnte nicht entfernt werden.".into()),
    }
}
