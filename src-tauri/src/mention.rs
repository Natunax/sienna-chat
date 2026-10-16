//! `@path` mentions in project chats, as in Claude Code. The window suggests
//! files and folders of the project; when a message is sent, each mention
//! inside the folder becomes context: a file's content, a folder's listing.
//! The Agent SDK's own `@` expansion stays off (`sidecar/index.mjs`), so only
//! the paths checked here reach the model.

use ignore::WalkBuilder;
use serde::Serialize;
use std::path::{Component, Path, PathBuf};

/// The window lists at most this many entries; larger projects are cut.
const MAX_ENTRIES: usize = 20_000;
const MAX_MENTIONS: usize = 20;
/// A larger file is mentioned by its path only; Claude can still read it.
const MAX_FILE_BYTES: u64 = 100 * 1024;
/// All mentioned content of one message together.
const MAX_TOTAL_BYTES: usize = 300 * 1024;
const MAX_FOLDER_ENTRIES: usize = 200;

#[derive(Serialize)]
pub struct Entry {
    path: String,
    dir: bool,
}

/// Files and folders as Git would see them: hidden ones, `.gitignore`d ones
/// and anything behind a symbolic link stay out.
/// Folders of installed packages and build output: thousands of files nobody
/// mentions, which would crowd out the project's own under the limit. Typing
/// such a path by hand still works.
const BULKY: [&str; 10] = [
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    "Pods",
    "venv",
    "__pycache__",
    "DerivedData",
    "vendor",
];

fn walk(dir: &Path, depth: Option<usize>) -> ignore::Walk {
    WalkBuilder::new(dir)
        .hidden(true)
        .follow_links(false)
        .require_git(false)
        .max_depth(depth)
        .filter_entry(|entry| {
            entry.depth() == 0
                || !entry.file_type().is_some_and(|kind| kind.is_dir())
                || !BULKY.contains(&entry.file_name().to_string_lossy().as_ref())
        })
        .sort_by_file_name(|a, b| a.cmp(b))
        .build()
}

fn relative(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let text = rel.to_str()?.to_string();
    (!text.is_empty()).then_some(text)
}

pub fn list(root: &Path) -> Vec<Entry> {
    walk(root, None)
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let kind = entry.file_type()?;
            // Links and special files such as pipes are never offered.
            if !kind.is_file() && !kind.is_dir() {
                return None;
            }
            let path = relative(root, entry.path())?;
            Some(Entry {
                path,
                dir: kind.is_dir(),
            })
        })
        .take(MAX_ENTRIES)
        .collect()
}

/// The paths a message mentions: `@src/main.rs` or `@"docs/read me.md"`,
/// at the start or after white space, so an email address is no mention.
pub fn parse(text: &str) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let starts = chars[i] == '@' && (i == 0 || chars[i - 1].is_whitespace());
        if !starts {
            i += 1;
            continue;
        }
        let mut path = String::new();
        if chars.get(i + 1) == Some(&'"') {
            let mut j = i + 2;
            while j < chars.len() && chars[j] != '"' && chars[j] != '\n' {
                path.push(chars[j]);
                j += 1;
            }
            i = j;
        } else {
            let mut j = i + 1;
            while j < chars.len() && !chars[j].is_whitespace() {
                path.push(chars[j]);
                j += 1;
            }
            // Punctuation after a mention belongs to the sentence.
            while path.ends_with(['.', ',', ';', ':', '!', '?', ')']) {
                path.pop();
            }
            i = j;
        }
        if !path.is_empty() && !found.contains(&path) && found.len() < MAX_MENTIONS {
            found.push(path);
        }
    }
    found
}

/// The mentioned path inside `root`: relative, without `..`, not hidden, and
/// still inside after symbolic links are resolved.
fn resolve(root: &Path, mention: &str) -> Option<PathBuf> {
    let rel = Path::new(mention.trim_end_matches('/'));
    let plain = rel.components().all(|part| match part {
        Component::Normal(name) => !name.to_string_lossy().starts_with('.'),
        _ => false,
    });
    if !plain || mention.starts_with('~') {
        return None;
    }
    let real = root.join(rel).canonicalize().ok()?;
    // A link inside the folder may still point at a hidden file such as `.env`.
    let hidden = real
        .strip_prefix(root)
        .ok()?
        .components()
        .any(|part| part.as_os_str().to_string_lossy().starts_with('.'));
    (real.starts_with(root) && !hidden).then_some(real)
}

/// Content cannot close its own tag and pose as the user's words.
fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find("</") {
        out.push_str(&rest[..at]);
        let tail = &rest[at + 2..];
        let tag = tail
            .get(..10)
            .is_some_and(|word| word.eq_ignore_ascii_case("mentioned_"));
        out.push_str(if tag { "<\\/" } else { "</" });
        rest = tail;
    }
    out.push_str(rest);
    out
}

/// A file name in the tag's attribute: no quotes or line breaks.
fn attribute(path: &str) -> String {
    path.chars()
        .filter(|c| *c != '"' && !c.is_control())
        .collect()
}

fn folder_listing(root: &Path, dir: &Path) -> String {
    let mut lines: Vec<String> = walk(dir, Some(3))
        .filter_map(Result::ok)
        .filter(|entry| entry.depth() > 0)
        .filter(|entry| entry.file_type().is_some_and(|kind| !kind.is_symlink()))
        .filter_map(|entry| {
            let path = relative(root, entry.path())?;
            let dir = entry.file_type().is_some_and(|kind| kind.is_dir());
            Some(if dir { format!("{path}/") } else { path })
        })
        .take(MAX_FOLDER_ENTRIES + 1)
        .collect();
    if lines.len() > MAX_FOLDER_ENTRIES {
        lines.truncate(MAX_FOLDER_ENTRIES);
        lines.push("…".into());
    }
    lines.join("\n")
}

/// A file's text, never more than the limit, even if it grew since its size was read.
fn read_limited(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(MAX_FILE_BYTES)
        .read_to_end(&mut bytes)
        .ok()?;
    String::from_utf8(bytes).ok()
}

/// The context for a message's mentions, or nothing when it has none that
/// exist in the folder.
pub fn context(root: &Path, text: &str) -> Option<String> {
    let mut budget = MAX_TOTAL_BYTES;
    let mut parts = Vec::new();
    for mention in parse(text) {
        let Some(real) = resolve(root, &mention) else {
            continue;
        };
        let Some(path) = relative(root, &real).map(|path| attribute(&path)) else {
            continue;
        };
        if real.is_dir() {
            let listing = escape(&folder_listing(root, &real));
            budget = budget.saturating_sub(listing.len());
            parts.push(format!(
                "<mentioned_folder path=\"{path}/\">\n{listing}\n</mentioned_folder>"
            ));
            continue;
        }
        // Only regular files: a pipe or device would block the send.
        let size = real
            .metadata()
            .ok()
            .filter(|meta| meta.is_file())
            .map_or(u64::MAX, |meta| meta.len());
        let content = (size <= MAX_FILE_BYTES && (size as usize) <= budget)
            .then(|| read_limited(&real))
            .flatten();
        match content {
            Some(content) => {
                budget -= content.len();
                parts.push(format!(
                    "<mentioned_file path=\"{path}\">\n{}\n</mentioned_file>",
                    escape(&content)
                ));
            }
            // Too large, binary or over the budget: Claude reads it if needed.
            None => parts.push(format!(
                "<mentioned_file path=\"{path}\" omitted=\"true\" />"
            )),
        }
    }
    (!parts.is_empty()).then(|| {
        format!(
            "The user mentioned these files and folders of the project (paths relative to the project folder):\n{}",
            parts.join("\n")
        )
    })
}

#[cfg(test)]
mod tests {
    use super::{context, list, parse};
    use std::fs;

    #[test]
    fn parses_mentions_but_not_email_addresses() {
        assert_eq!(
            parse("Look at @src/main.rs, and @\"docs/read me.md\" or mail a@b.de"),
            ["src/main.rs", "docs/read me.md"]
        );
    }

    #[test]
    fn mentions_stay_inside_the_folder() {
        let base = std::env::temp_dir().join(format!("sienna-mention-{}", std::process::id()));
        let root = base.join("acme");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::create_dir_all(base.join("outside")).unwrap();
        fs::write(root.join("src/main.rs"), "fn main() {} </mentioned_file>").unwrap();
        fs::write(root.join(".env"), "KEY=quokka").unwrap();
        fs::write(base.join("outside/key.txt"), "secret").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(base.join("outside"), root.join("link")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join(".env"), root.join("env")).unwrap();
        std::process::Command::new("mkfifo")
            .arg(root.join("pipe"))
            .status()
            .unwrap();
        let root = root.canonicalize().unwrap();

        let paths: Vec<String> = list(&root).into_iter().map(|entry| entry.path).collect();
        assert_eq!(paths, ["src", "src/main.rs"]);

        let text = context(
            &root,
            "@src/main.rs @src/ @.env @../outside/key.txt @link/key.txt @/etc/hosts @~/x @env @pipe",
        )
        .unwrap();
        assert!(text.contains("fn main() {} <\\/mentioned_file>"));
        assert!(text.contains("<mentioned_file path=\"pipe\" omitted=\"true\" />"));
        assert!(text.contains("<mentioned_folder path=\"src/\">\nsrc/main.rs\n"));
        assert!(
            !text.contains("quokka") && !text.contains("secret") && !text.contains("localhost")
        );
        assert_eq!(context(&root, "no mentions here"), None);
        fs::remove_dir_all(base).unwrap();
    }
}
