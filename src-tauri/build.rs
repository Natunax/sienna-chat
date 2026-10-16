use std::path::Path;
use std::process::Command;

/// Compiles the dictation helper (`voice/main.swift`) into `binaries/`, where
/// the bundle picks it up as an external binary. Its Info.plist is embedded,
/// because the Speech framework refuses to run without usage descriptions.
fn build_voice() {
    let target = std::env::var("TARGET").expect("cargo sets TARGET");
    let arch = if target.starts_with("aarch64") {
        "arm64"
    } else {
        "x86_64"
    };
    let source = Path::new("voice/main.swift");
    let plist = Path::new("voice/Info.plist");
    let output = Path::new("binaries").join(format!("sienna-voice-{target}"));
    println!("cargo:rerun-if-changed={}", source.display());
    println!("cargo:rerun-if-changed={}", plist.display());

    let modified = |path: &Path| path.metadata().and_then(|meta| meta.modified()).ok();
    let fresh = match (modified(&output), modified(source), modified(plist)) {
        (Some(built), Some(code), Some(info)) => built >= code && built >= info,
        _ => false,
    };
    if fresh {
        return;
    }
    std::fs::create_dir_all("binaries").expect("create binaries/");
    let status = Command::new("xcrun")
        .args(["swiftc", "-O", "-swift-version", "5", "-target"])
        .arg(format!("{arch}-apple-macos13.0"))
        .args(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT"])
        .args(["-Xlinker", "__info_plist", "-Xlinker"])
        .arg(plist)
        .arg("-o")
        .arg(&output)
        .arg(source)
        .status()
        .expect("run swiftc (install the Xcode Command Line Tools)");
    assert!(
        status.success(),
        "swiftc could not build the dictation helper"
    );
}

fn main() {
    build_voice();
    tauri_build::build()
}
