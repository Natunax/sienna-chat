//! Working copies for a second model's answer: it works in its own copy of
//! the project, so both answers can change files without getting in each
//! other's way. A copy is two APFS clones in Sienna's caches, `base` (the
//! project as it was) and `work` (what the answer changed); the user can take
//! the difference over into the project.

use ignore::WalkBuilder;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};

static ROOT: OnceLock<PathBuf> = OnceLock::new();
static COUNTER: AtomicU64 = AtomicU64::new(0);
/// Copies nobody took over are removed after two weeks.
const KEEP: Duration = Duration::from_secs(14 * 24 * 60 * 60);
/// Only this many changed files are listed or taken over at once.
const MAX_CHANGES: usize = 2_000;

/// Sets where copies live (the app's caches) and removes old ones.
pub fn init(caches: PathBuf) {
    let root = caches.join("copies");
    let _ = std::fs::create_dir_all(&root);
    let root = root.canonicalize().unwrap_or(root);
    if let Ok(entries) = std::fs::read_dir(&root) {
        for entry in entries.flatten() {
            let old = entry
                .metadata()
                .and_then(|meta| meta.modified())
                .ok()
                .and_then(|time| SystemTime::now().duration_since(time).ok())
                .is_some_and(|age| age > KEEP);
            if old {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
    let _ = ROOT.set(root);
}

/// Whether `path` (canonical) is the `work` folder of a copy.
pub fn is_work(path: &Path) -> bool {
    let Some(root) = ROOT.get() else { return false };
    let Ok(rest) = path.strip_prefix(root) else {
        return false;
    };
    let parts: Vec<_> = rest.components().collect();
    parts.len() == 2
        && matches!(parts[0], Component::Normal(_))
        && parts[1] == Component::Normal("work".as_ref())
}

/// A clone of `from` at `to`; APFS shares the data until a file changes.
fn clone(from: &Path, to: &Path) -> Result<(), String> {
    let failed = || "error.copyFailed".to_string();
    let source = format!("{}/.", from.display());
    let cloned = Command::new("/bin/cp")
        .args(["-c", "-R", "-p"])
        .arg(&source)
        .arg(to)
        .status()
        .map_err(|_| failed())?;
    if cloned.success() {
        return Ok(());
    }
    // Not on APFS: a plain copy.
    let _ = std::fs::remove_dir_all(to);
    std::fs::create_dir_all(to).map_err(|_| failed())?;
    let copied = Command::new("/bin/cp")
        .args(["-R", "-p"])
        .arg(&source)
        .arg(to)
        .status()
        .map_err(|_| failed())?;
    copied.success().then_some(()).ok_or_else(failed)
}

/// Makes a copy of the (validated) project; returns its `work` folder.
pub fn create(project: &Path) -> Result<PathBuf, String> {
    let root = ROOT.get().ok_or("error.copyFailed")?;
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|time| time.as_nanos())
        .unwrap_or(0);
    let id = format!("{nanos:x}{:x}", COUNTER.fetch_add(1, Ordering::Relaxed));
    let dir = root.join(id);
    let (base, work) = (dir.join("base"), dir.join("work"));
    std::fs::create_dir_all(&base).map_err(|_| "error.copyFailed")?;
    std::fs::create_dir_all(&work).map_err(|_| "error.copyFailed")?;
    // Both clones at once: a large project takes seconds each.
    let made = std::thread::scope(|scope| {
        let first = scope.spawn(|| clone(project, &base));
        let second = clone(project, &work);
        first
            .join()
            .unwrap_or(Err("error.copyFailed".into()))
            .and(second)
    });
    if made.is_err() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    made?;
    work.canonicalize().map_err(|_| "error.copyFailed".into())
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Added,
    Modified,
    Deleted,
}

#[derive(Serialize, Debug)]
pub struct Change {
    path: String,
    kind: Kind,
}

/// The project's files as Git sees them: no hidden or ignored ones, no links.
fn files(root: &Path) -> BTreeMap<String, PathBuf> {
    WalkBuilder::new(root)
        .hidden(true)
        .follow_links(false)
        .require_git(false)
        .build()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_some_and(|kind| kind.is_file()))
        .filter_map(|entry| {
            let rel = entry.path().strip_prefix(root).ok()?.to_str()?.to_string();
            Some((rel, entry.path().to_path_buf()))
        })
        .collect()
}

fn same(a: &Path, b: &Path) -> bool {
    match (std::fs::metadata(a), std::fs::metadata(b)) {
        (Ok(x), Ok(y)) if x.len() != y.len() => false,
        (Ok(_), Ok(_)) => std::fs::read(a).ok() == std::fs::read(b).ok(),
        _ => false,
    }
}

/// The copy's folders from its `work` path, after checking it is one.
fn folders(work: &str) -> Result<(PathBuf, PathBuf), String> {
    let work = Path::new(work)
        .canonicalize()
        .map_err(|_| "error.copyMissing".to_string())?;
    if !is_work(&work) {
        return Err("error.copyMissing".into());
    }
    let base = work.with_file_name("base");
    Ok((base, work))
}

/// What the answer changed in its copy, compared with the project as it was.
pub fn changes(work: &str) -> Result<Vec<Change>, String> {
    let (base, work) = folders(work)?;
    let (before, after) = (files(&base), files(&work));
    let mut list = Vec::new();
    for (path, file) in &after {
        match before.get(path) {
            None => list.push(Change {
                path: path.clone(),
                kind: Kind::Added,
            }),
            Some(old) if !same(old, file) => list.push(Change {
                path: path.clone(),
                kind: Kind::Modified,
            }),
            _ => {}
        }
    }
    for path in before.keys().filter(|path| !after.contains_key(*path)) {
        list.push(Change {
            path: path.clone(),
            kind: Kind::Deleted,
        });
    }
    list.truncate(MAX_CHANGES);
    Ok(list)
}

#[derive(Serialize, Default, Debug)]
pub struct Applied {
    applied: Vec<String>,
    /// Changed in the project too since the copy was made; left alone.
    conflicts: Vec<String>,
}

impl Applied {
    pub fn conflicts_empty(&self) -> bool {
        self.conflicts.is_empty()
    }
}

/// The project file for a relative path: plain parts only, and its folder
/// inside the project after links are resolved.
fn target(project: &Path, rel: &str) -> Option<PathBuf> {
    let path = Path::new(rel);
    if !path
        .components()
        .all(|part| matches!(part, Component::Normal(_)))
    {
        return None;
    }
    let full = project.join(path);
    let mut folder = full.parent()?.to_path_buf();
    // The nearest folder that exists must be inside the project.
    while !folder.exists() {
        folder = folder.parent()?.to_path_buf();
    }
    let real = folder.canonicalize().ok()?;
    let link = std::fs::symlink_metadata(&full).is_ok_and(|meta| meta.file_type().is_symlink());
    (real.starts_with(project) && !link).then_some(full)
}

/// Takes the copy's changes over into the project, file by file. A file the
/// project changed too since the copy was made is left as it is, unless
/// `force` names it: the user chose to replace it after seeing the conflict.
pub fn apply(work: &str, project: &Path, force: &[String]) -> Result<Applied, String> {
    let list = changes(work)?;
    let (base, work) = folders(work)?;
    let mut result = Applied::default();
    for change in list {
        let Some(dest) = target(project, &change.path) else {
            result.conflicts.push(change.path);
            continue;
        };
        let original = base.join(&change.path);
        // Already as in the copy (taken over before): nothing to do.
        let done_already = match change.kind {
            Kind::Deleted => !dest.exists(),
            Kind::Added | Kind::Modified => same(&dest, &work.join(&change.path)),
        };
        if done_already {
            continue;
        }
        let untouched = force.contains(&change.path)
            || match change.kind {
                Kind::Added => !dest.exists(),
                Kind::Modified | Kind::Deleted => same(&dest, &original),
            };
        if !untouched {
            result.conflicts.push(change.path);
            continue;
        }
        let done = match change.kind {
            Kind::Deleted => std::fs::remove_file(&dest).is_ok(),
            Kind::Added | Kind::Modified => {
                dest.parent()
                    .is_some_and(|folder| std::fs::create_dir_all(folder).is_ok())
                    && std::fs::copy(work.join(&change.path), &dest).is_ok()
            }
        };
        if done {
            result.applied.push(change.path);
        } else {
            result.conflicts.push(change.path);
        }
    }
    Ok(result)
}

/// Removes a copy.
pub fn discard(work: &str) -> Result<(), String> {
    let (_, work) = folders(work)?;
    let dir = work.parent().ok_or("error.copyMissing")?;
    std::fs::remove_dir_all(dir).map_err(|_| "error.copyMissing".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn copies_changes_and_takes_them_over_without_overwriting() {
        let base = std::env::temp_dir().join(format!("sienna-copy-{}", std::process::id()));
        let project = base.join("acme");
        fs::create_dir_all(project.join("src")).unwrap();
        fs::write(project.join("src/a.rs"), "a").unwrap();
        fs::write(project.join("src/b.rs"), "b").unwrap();
        fs::write(project.join("src/c.rs"), "c").unwrap();
        init(base.join("caches"));
        let project = project.canonicalize().unwrap();

        let work = create(&project).unwrap();
        assert!(is_work(&work));
        assert!(!is_work(&project));
        fs::write(work.join("src/a.rs"), "a2").unwrap();
        fs::write(work.join("src/b.rs"), "b2").unwrap();
        fs::remove_file(work.join("src/c.rs")).unwrap();
        fs::write(work.join("src/new.rs"), "n").unwrap();
        // The project's own answer changed b meanwhile.
        fs::write(project.join("src/b.rs"), "b-main").unwrap();

        let work = work.to_str().unwrap();
        let mut kinds: Vec<_> = changes(work)
            .unwrap()
            .into_iter()
            .map(|c| (c.path, c.kind))
            .collect();
        kinds.sort_by(|a, b| a.0.cmp(&b.0));
        assert_eq!(kinds.len(), 4);

        let result = apply(work, &project, &[]).unwrap();
        assert_eq!(result.conflicts, ["src/b.rs"]);
        assert_eq!(fs::read_to_string(project.join("src/a.rs")).unwrap(), "a2");
        assert_eq!(
            fs::read_to_string(project.join("src/b.rs")).unwrap(),
            "b-main"
        );
        assert!(!project.join("src/c.rs").exists());
        assert_eq!(fs::read_to_string(project.join("src/new.rs")).unwrap(), "n");
        // Replacing the conflict on purpose.
        let forced = apply(work, &project, &["src/b.rs".to_string()]).unwrap();
        assert!(forced.conflicts.is_empty());
        assert_eq!(fs::read_to_string(project.join("src/b.rs")).unwrap(), "b2");
        assert!(changes(project.to_str().unwrap()).is_err());
        assert!(target(&project, "../x").is_none());

        discard(work).unwrap();
        fs::remove_dir_all(base).unwrap();
    }
}
