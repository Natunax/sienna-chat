use std::path::Path;
use std::process::Command;

/// Compiles a Swift helper (`<name>/main.swift`) into `binaries/`, where the
/// bundle picks it up as an external binary. An Info.plist next to it is
/// embedded: the Speech framework refuses to run without usage descriptions.
fn build_helper(name: &str, binary: &str) {
    let target = std::env::var("TARGET").expect("cargo sets TARGET");
    let arch = if target.starts_with("aarch64") {
        "arm64"
    } else {
        "x86_64"
    };
    let source = Path::new(name).join("main.swift");
    let plist = Path::new(name).join("Info.plist");
    let has_plist = plist.is_file();
    let output = Path::new("binaries").join(format!("{binary}-{target}"));
    println!("cargo:rerun-if-changed={}", source.display());
    if has_plist {
        println!("cargo:rerun-if-changed={}", plist.display());
    }

    let modified = |path: &Path| path.metadata().and_then(|meta| meta.modified()).ok();
    let newest_input = [
        modified(&source),
        has_plist.then(|| modified(&plist)).flatten(),
    ]
    .into_iter()
    .flatten()
    .max();
    if let (Some(built), Some(input)) = (modified(&output), newest_input) {
        if built >= input {
            return;
        }
    }
    std::fs::create_dir_all("binaries").expect("create binaries/");
    let mut command = Command::new("xcrun");
    command
        .args(["swiftc", "-O", "-swift-version", "5", "-target"])
        .arg(format!("{arch}-apple-macos13.0"));
    if has_plist {
        command
            .args(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT"])
            .args(["-Xlinker", "__info_plist", "-Xlinker"])
            .arg(&plist);
    }
    let status = command
        .arg("-o")
        .arg(&output)
        .arg(&source)
        .status()
        .expect("run swiftc (install the Xcode Command Line Tools)");
    assert!(status.success(), "swiftc could not build {binary}");
}

fn main() {
    // The engine looks for the snapshot helper under this name while developing.
    println!(
        "cargo:rustc-env=TARGET_TRIPLE={}",
        std::env::var("TARGET").expect("cargo sets TARGET")
    );
    // Dictation, and the snapshots that let a model look at its artifacts.
    build_helper("voice", "sienna-voice");
    build_helper("snapshot", "sienna-snapshot");
    tauri_build::build()
}
