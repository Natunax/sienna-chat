//! Working copies for a second model's answer: it works in its own copy of
//! the project, so both answers can change files without getting in each
//! other's way. A copy is two APFS clones in Sienna's caches, `base` (the
//! project as it was) and `work` (what the answer changed); the user can take
//! the difference over into the project.

use ignore::WalkBuilder;
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs::{File, Metadata, OpenOptions};
use std::io::Read;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
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

/// The folder all copies live in, once `init` ran.
pub fn root() -> Option<&'static Path> {
    ROOT.get().map(PathBuf::as_path)
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
/// Top-level entries named in `skip` are left out.
fn clone(from: &Path, to: &Path, skip: &[String]) -> Result<(), String> {
    let failed = || "error.copyFailed".to_string();
    let entries: Vec<PathBuf> = std::fs::read_dir(from)
        .map_err(|_| failed())?
        .filter_map(Result::ok)
        .filter(|entry| !skip.contains(&entry.file_name().to_string_lossy().into_owned()))
        .map(|entry| entry.path())
        .collect();
    if entries.is_empty() {
        return Ok(());
    }
    let cloned = Command::new("/bin/cp")
        .args(["-c", "-R", "-p"])
        .args(&entries)
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
        .args(&entries)
        .arg(to)
        .status()
        .map_err(|_| failed())?;
    copied.success().then_some(()).ok_or_else(failed)
}

/// Dependency and build folders the walker ignores (Git ignores them), so the
/// `base` clone need not carry them: `changes` never looks inside.
fn ignored_bulk(project: &Path) -> Vec<String> {
    let seen: Vec<String> = WalkBuilder::new(project)
        .hidden(true)
        .follow_links(false)
        .require_git(false)
        .max_depth(Some(1))
        .build()
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    crate::mention::BULKY
        .iter()
        .filter(|name| !seen.iter().any(|seen| seen == **name))
        .filter(|name| project.join(name).is_dir())
        .map(|name| name.to_string())
        .collect()
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
        let first = scope.spawn(|| clone(project, &base, &ignored_bulk(project)));
        let second = clone(project, &work, &[]);
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

/// Opens a regular file without following a link at the last component.
fn open_plain(path: &Path) -> std::io::Result<(File, Metadata)> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)?;
    let meta = file.metadata()?;
    if !meta.is_file() {
        return Err(std::io::ErrorKind::InvalidInput.into());
    }
    Ok((file, meta))
}

/// Whether two files have the same content. Clones made with `cp -p` keep
/// their modification time, so equal size and time means unchanged without
/// reading anything.
fn same(a: &Path, b: &Path) -> bool {
    let (Ok((mut x, xm)), Ok((mut y, ym))) = (open_plain(a), open_plain(b)) else {
        return false;
    };
    if xm.len() != ym.len() {
        return false;
    }
    if xm
        .modified()
        .ok()
        .is_some_and(|time| Some(time) == ym.modified().ok())
    {
        return true;
    }
    let (mut left, mut right) = (vec![0u8; 64 * 1024], vec![0u8; 64 * 1024]);
    loop {
        let Ok(n) = read_full(&mut x, &mut left) else {
            return false;
        };
        let Ok(m) = read_full(&mut y, &mut right) else {
            return false;
        };
        if n != m || left[..n] != right[..m] {
            return false;
        }
        if n == 0 {
            return true;
        }
    }
}

/// Fills `buf` unless the file ends first; returns the bytes read.
fn read_full(file: &mut File, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut filled = 0;
    while filled < buf.len() {
        match file.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => {}
            Err(err) => return Err(err),
        }
    }
    Ok(filled)
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

/// Copies `from` over `to` inside `project`. Neither end may be a link, which
/// is checked again here: a link swapped in after `target` looked must not
/// lead the write out of the project.
fn copy_file(from: &Path, to: &Path, project: &Path) -> std::io::Result<()> {
    let denied = || std::io::Error::from(std::io::ErrorKind::PermissionDenied);
    let (mut source, meta) = open_plain(from)?;
    let folder = to.parent().ok_or_else(denied)?;
    std::fs::create_dir_all(folder)?;
    let mut walk = Some(folder);
    while let Some(dir) = walk.filter(|dir| *dir != project) {
        if !dir.starts_with(project) || std::fs::symlink_metadata(dir)?.file_type().is_symlink() {
            return Err(denied());
        }
        walk = dir.parent();
    }
    if std::fs::symlink_metadata(to).is_ok_and(|meta| !meta.is_file()) {
        return Err(denied());
    }
    let mut dest = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(meta.permissions().mode() & 0o7777)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(to)?;
    std::io::copy(&mut source, &mut dest)?;
    dest.set_permissions(meta.permissions())
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
                copy_file(&work.join(&change.path), &dest, project).is_ok()
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

    #[test]
    fn same_compares_content_when_times_differ_and_refuses_links() {
        let dir = std::env::temp_dir().join(format!("sienna-same-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let big = vec![7u8; 200_000];
        let mut other = big.clone();
        other[150_000] = 8;
        fs::write(dir.join("a"), &big).unwrap();
        fs::write(dir.join("b"), &big).unwrap();
        fs::write(dir.join("c"), &other).unwrap();
        assert!(same(&dir.join("a"), &dir.join("b")));
        assert!(!same(&dir.join("a"), &dir.join("c")));
        std::os::unix::fs::symlink(dir.join("a"), dir.join("link")).unwrap();
        assert!(!same(&dir.join("link"), &dir.join("a")));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn copy_file_keeps_mode_and_stays_inside_the_project() {
        let dir = std::env::temp_dir().join(format!("sienna-cf-{}", std::process::id()));
        let project = dir.join("project");
        let outside = dir.join("outside");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let project = project.canonicalize().unwrap();
        fs::write(dir.join("src.sh"), "run").unwrap();
        fs::set_permissions(dir.join("src.sh"), fs::Permissions::from_mode(0o755)).unwrap();
        copy_file(&dir.join("src.sh"), &project.join("new/x.sh"), &project).unwrap();
        let mode = fs::metadata(project.join("new/x.sh"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o755);
        // A folder swapped for a link, and a file swapped for one.
        std::os::unix::fs::symlink(&outside, project.join("swapped")).unwrap();
        assert!(copy_file(&dir.join("src.sh"), &project.join("swapped/y"), &project).is_err());
        assert!(!outside.join("y").exists());
        std::os::unix::fs::symlink(outside.join("z"), project.join("z")).unwrap();
        assert!(copy_file(&dir.join("src.sh"), &project.join("z"), &project).is_err());
        assert!(!outside.join("z").exists());
        // A link as the source is refused.
        std::os::unix::fs::symlink(dir.join("src.sh"), dir.join("srclink")).unwrap();
        assert!(copy_file(&dir.join("srclink"), &project.join("w"), &project).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn base_skips_only_ignored_bulky_folders() {
        let dir = std::env::temp_dir().join(format!("sienna-bulk-{}", std::process::id()));
        let project = dir.join("p");
        fs::create_dir_all(project.join("node_modules/x")).unwrap();
        fs::create_dir_all(project.join("vendor")).unwrap();
        fs::write(project.join(".gitignore"), "node_modules\n").unwrap();
        fs::write(project.join("vendor/v.txt"), "v").unwrap();
        let skip = ignored_bulk(&project);
        assert_eq!(skip, ["node_modules"]);
        let to = dir.join("to");
        fs::create_dir_all(&to).unwrap();
        clone(&project, &to, &skip).unwrap();
        assert!(to.join("vendor/v.txt").exists() && !to.join("node_modules").exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
