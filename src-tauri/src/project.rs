//! The project folder Claude may read in a chat. Only real folders inside the
//! user's home folder or on an external volume qualify; the home folder itself,
//! the root, hidden folders such as `~/.ssh` and `~/Library` (app data,
//! Sienna's own included, keychains, mail) do not. The engine checks every
//! read against the canonical path returned here (`sidecar/project.mjs`).

use std::path::{Component, Path, PathBuf};

pub fn validate(path: &str) -> Result<PathBuf, String> {
    let invalid = || "error.projectInvalid".to_string();
    let canonical = Path::new(path).canonicalize().map_err(|_| invalid())?;
    if !canonical.is_dir() {
        return Err(invalid());
    }
    let home = std::env::var("HOME")
        .ok()
        .and_then(|home| Path::new(&home).canonicalize().ok())
        .ok_or_else(invalid)?;
    let under_home = canonical.starts_with(&home)
        && canonical != home
        && !canonical.starts_with(home.join("Library"));
    let on_volume = canonical.starts_with("/Volumes") && canonical.components().count() > 3;
    if !(under_home || on_volume) {
        return Err(invalid());
    }
    let hidden = canonical.components().any(|part| match part {
        Component::Normal(name) => name.to_string_lossy().starts_with('.'),
        _ => false,
    });
    if hidden {
        return Err(invalid());
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::validate;
    use std::fs;

    #[test]
    fn only_plain_folders_inside_home_qualify() {
        let base = std::env::temp_dir().join(format!("sienna-project-{}", std::process::id()));
        let home = base.join("home");
        fs::create_dir_all(home.join("code/acme")).unwrap();
        fs::create_dir_all(home.join(".ssh")).unwrap();
        fs::create_dir_all(home.join("Library/Application Support/sienna")).unwrap();
        fs::create_dir_all(base.join("elsewhere")).unwrap();
        fs::write(home.join("code/notes.txt"), "quokka").unwrap();
        // The only test that sets HOME, so no other test sees the change.
        std::env::set_var("HOME", &home);

        let cases = [
            (home.join("code/acme"), true),
            (home.join("code/acme/../acme"), true),
            (home.clone(), false),
            (home.join(".ssh"), false),
            (home.join("Library"), false),
            (home.join("Library/Application Support/sienna"), false),
            (home.join("code/notes.txt"), false),
            (home.join("code/missing"), false),
            (base.join("elsewhere"), false),
            ("/".into(), false),
            ("/etc".into(), false),
        ];
        for (path, allowed) in cases {
            assert_eq!(
                validate(path.to_str().unwrap()).is_ok(),
                allowed,
                "{}",
                path.display()
            );
        }
        fs::remove_dir_all(&base).unwrap();
    }
}
