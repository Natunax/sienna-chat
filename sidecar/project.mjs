// Project mode: Claude works in one folder the user picked, and nowhere else.
// Reading and searching run freely. Whether a change or a command needs the
// user's approval (`canUseTool` in index.mjs) depends on the chat's mode, as
// in Claude Code. A PreToolUse hook checks every tool call before it runs, so
// the folder limit and the always-ask commands hold in every mode.

import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const READ_TOOLS = ["Read", "Grep", "Glob"];
export const EDIT_TOOLS = ["Edit", "Write"];
export const RUN_TOOLS = ["Bash"];
export const MODES = ["auto", "default", "acceptEdits", "plan", "bypassPermissions", "readonly"];

// Commands that ask first in every mode, also when permissions are bypassed.
// This catches the usual ways of writing them, quoting and chaining included;
// it guards against accidents and the obvious tricks, not against every way a
// shell can delete or publish something (see README).
const SHELLS = ["sh", "bash", "zsh", "dash", "fish"];
const WRAPPERS = ["command", "builtin", "exec", "nohup", "time", "env", "nice", "xargs", "caffeinate"];

/** The words of each simple command; quotes and backslashes do not hide a word (`g""it`, `\rm`). */
function commandWords(command) {
  const plain = String(command ?? "")
    .replace(/\\\n/g, " ")
    .replace(/["'\\]/g, "");
  return plain
    .split(/;|&&|\|\||\||\n|\$\(|`|\(|\)|\{|\}/)
    .map((part) => part.trim().split(/\s+/).filter(Boolean))
    .filter((words) => words.length);
}

/** Drops variable assignments and wrappers such as `env`, `command` or `xargs` in front of the real command. */
function unwrap(words) {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) index++;
    else if (WRAPPERS.includes(basename(word))) {
      index++;
      while (index < words.length && words[index].startsWith("-")) index++;
    } else break;
  }
  return words.slice(index).map((word, position) => (position === 0 ? basename(word) : word));
}

function hasShortFlag(words, letters) {
  return words.some((word) => /^-[A-Za-z]+$/.test(word) && [...letters].some((letter) => word.includes(letter)));
}

function riskyGit(args) {
  // Global options come before the subcommand; -C and -c take a value.
  let index = 0;
  while (index < args.length && args[index].startsWith("-")) index += ["-C", "-c"].includes(args[index]) ? 2 : 1;
  const [sub, ...rest] = args.slice(index);
  if (sub === "push") return true;
  if (sub === "reset") return rest.some((word) => ["--hard", "--keep", "--merge"].includes(word));
  if (sub === "clean") return hasShortFlag(rest, "f") || rest.includes("--force");
  if (sub === "branch") return rest.includes("-D") || (rest.includes("--delete") && rest.includes("--force"));
  if (sub === "checkout" || sub === "restore") return rest.includes("-f") || rest.includes("--force") || rest.includes(".");
  return false;
}

function riskyWords(words, previous) {
  const [name, ...args] = unwrap(words);
  if (!name) return false;
  if (["sudo", "doas", "su", "dd", "diskutil", "shred", "srm"].includes(name) || name.startsWith("mkfs")) return true;
  if (name === "rm") return hasShortFlag(args, "rR") || args.includes("--recursive");
  if (name === "find") return args.includes("-delete") || args.some((word, i) => /^-exec/.test(word) && args[i + 1] === "rm");
  if (name === "git") return riskyGit(args);
  if (["chmod", "chown"].includes(name)) return hasShortFlag(args, "R") || args.includes("--recursive");
  if (SHELLS.includes(name)) {
    // `bash -c '…'` runs its own command line; a shell reading from a pipe runs a download.
    const at = args.indexOf("-c");
    if (at >= 0) return isRisky(args.slice(at + 1).join(" "));
    return Boolean(previous && ["curl", "wget"].includes(unwrap(previous)[0]));
  }
  return false;
}

export function isRisky(command) {
  const all = commandWords(command);
  return all.some((words, index) => riskyWords(words, all[index - 1]));
}

const MAX_INSTRUCTIONS_BYTES = 64 * 1024;

/** The real path, following symbolic links; for a path that does not exist yet, its nearest real parent. */
function realPath(path) {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(realPath(parent), basename(path));
  }
}

function isInside(root, path) {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** The path a file tool call touches; Grep and Glob default to the project folder. */
function targetOf(toolName, input) {
  const raw = toolName === "Grep" || toolName === "Glob" ? input?.path : input?.file_path;
  return typeof raw === "string" && raw ? raw : ".";
}

/**
 * Paths Claude Code expands itself, after this check: `~` becomes the home
 * folder, variables their value. Resolving them here would check the wrong place.
 */
function expandsLater(value) {
  return typeof value === "string" && (/^\s*~/.test(value) || value.includes("$") || value.includes("\0"));
}

/** A search pattern that names its own location: absolute, from home, or climbing out with `..`. */
function leavesFolder(pattern) {
  if (typeof pattern !== "string" || !pattern) return false;
  return isAbsolute(pattern.trim()) || expandsLater(pattern) || pattern.split(/[\\/]/).includes("..");
}

/**
 * Hook options that allow the read tools (plus web search when it is on) on
 * paths inside `projectDir` and deny everything outside it. Changes and
 * commands are allowed, asked about or left to Claude Code's auto mode
 * depending on `mode()`; `onEdit` hears about each change allowed without asking.
 */
export function projectGuard(projectDir, webTools, { mode = () => "default", onEdit = () => {} } = {}) {
  const root = realPath(projectDir);
  const deny = (reason) => ({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  });
  const decide = (decision) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision } });

  // No decision: Claude Code's permission mode decides (auto mode's classifier).
  const undecided = {};
  const planOnly = "Plan mode: only read and investigate, then present a plan. Do not change files or run commands.";
  // A second model's answer next to the chat's own (comparing models) never touches the folder.
  const readOnly = "This answer is compared with another model's; describe changes and commands instead of making them.";

  const check = async (input) => {
    const tool = input.tool_name;
    const current = mode();
    if (webTools.includes(tool)) return decide("allow");
    // Commands run in the project folder.
    if (RUN_TOOLS.includes(tool)) {
      if (current === "plan") return deny(planOnly);
      if (current === "readonly") return deny(readOnly);
      if (isRisky(input.tool_input?.command)) return decide("ask");
      if (current === "bypassPermissions") return decide("allow");
      return current === "auto" ? undecided : decide("ask");
    }
    const editing = EDIT_TOOLS.includes(tool);
    if (!READ_TOOLS.includes(tool) && !editing) return deny("This tool is not available in Sienna.");
    const params = input.tool_input ?? {};
    const outside = "This path is outside the project folder.";
    if (expandsLater(targetOf(tool, params))) return deny(outside);
    // Glob's pattern and Grep's glob filter can name a place of their own.
    if (tool === "Glob" && leavesFolder(params.pattern)) return deny(outside);
    if (tool === "Grep" && leavesFolder(params.glob)) return deny(outside);
    const target = targetOf(tool, params);
    const absolute = isAbsolute(target) ? target : resolve(root, target);
    const real = realPath(absolute);
    if (!isInside(root, real)) return deny(outside);
    if (!editing) return decide("allow");
    // Git's own files (hooks among them) are never written by Claude, in any
    // repository below the folder; the file system ignores case, so this does too.
    if (relative(root, real).split(sep).some((part) => part.toLowerCase() === ".git")) {
      return deny("Files in .git cannot be changed.");
    }
    if (current === "plan") return deny(planOnly);
    if (current === "readonly") return deny(readOnly);
    if (current === "default") return decide("ask");
    onEdit(tool, input.tool_input ?? {}, input.tool_use_id ?? null);
    return decide("allow");
  };

  return { PreToolUse: [{ hooks: [check] }] };
}

/**
 * The project's CLAUDE.md, read here rather than through Claude Code's
 * settings, which could run hooks. Only a regular file inside the folder: a
 * link to elsewhere (shell history, another project's .env) is skipped.
 */
export function projectInstructions(projectDir) {
  const root = realPath(projectDir);
  for (const name of ["CLAUDE.md", ".claude/CLAUDE.md"]) {
    try {
      const real = realpathSync(join(projectDir, name));
      if (!isInside(root, real) || !statSync(real).isFile()) continue;
      const text = readFileSync(real, "utf8");
      return text.length > MAX_INSTRUCTIONS_BYTES ? text.slice(0, MAX_INSTRUCTIONS_BYTES) : text;
    } catch {
      // Try the next location.
    }
  }
  return "";
}

export function projectPrompt(projectDir) {
  const lines = [
    "",
    `The user opened the project folder "${basename(projectDir)}" (${projectDir}).`,
    "You can read and search files in this folder with Read, Grep and Glob, change files with Edit and Write, and run shell commands in it with Bash.",
    "Depending on the chat's mode, the user approves changes and commands before they run. Make focused changes, and say in one line what a command is for.",
    "If the user declines a change or command, do not try it another way; ask how they want to go on.",
    "Answer from the code: cite files with their path relative to the project folder and line numbers where it helps.",
  ];
  const instructions = projectInstructions(projectDir);
  if (instructions) {
    // The file cannot close the tag around it and speak as the system prompt.
    const contained = instructions.replace(/<\/?\s*project_instructions\s*>/gi, "");
    lines.push("", "The project's CLAUDE.md:", "<project_instructions>", contained, "</project_instructions>");
  }
  return lines.join("\n");
}
