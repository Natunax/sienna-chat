// Project mode: Claude works in one folder the user picked, and nowhere else.
// Reading and searching run freely. Whether a change or a command needs the
// user's approval (`canUseTool` in index.mjs) depends on the chat's mode, as
// in Claude Code. A PreToolUse hook checks every tool call before it runs, so
// the folder limit and the always-ask commands hold in every mode.

import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// Shows content next to the chat; it touches no file (`artifacts.mjs`).
const ARTIFACT_TOOL = "mcp__sienna__artifact";

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

// Commands that only read. They run without asking in every mode, but only
// when the command line is plain and every option is on the command's own
// list: anything the check does not fully understand asks, as before.
// Unquoted, only these characters: no globs, braces, comments, `~`,
// variables, substitutions, escapes or redirects (other than to /dev/null).
const PLAIN = /^[\p{L}\p{N}_./:@%+,=-]$/u;

const flags = (pattern) => (arg) => pattern.test(arg);

/**
 * For each command, the options it may use; `takes` lists options that take
 * the next word as their value (checked as a path like any other word).
 */
const READ_COMMANDS = {
  pwd: { ok: flags(/^$/) },
  ls: { ok: flags(/^-[1aAlhrtSFdGRonpc]+$/) },
  cat: { ok: flags(/^-[nbsvet]+$/) },
  head: { ok: flags(/^-(\d+|[nc]\d*)$/), takes: ["-n", "-c"] },
  tail: { ok: flags(/^-(\d+|[nc]\d*|r)$/), takes: ["-n", "-c"] },
  wc: { ok: flags(/^-[lwcm]+$/) },
  du: { ok: flags(/^-([shc]+|d\d*)$/), takes: ["-d"] },
  sort: { ok: flags(/^-[nrufb]+$/) },
  uniq: { ok: flags(/^-[cdu]+$/), positional: 1 },
  diff: { ok: flags(/^-[uqbwi]+$/) },
  basename: { ok: flags(/^$/) },
  dirname: { ok: flags(/^$/) },
  realpath: { ok: flags(/^$/) },
  echo: { ok: flags(/^-[ne]$/) },
  which: { ok: flags(/^-a$/) },
  grep: {
    ok: flags(/^(-[rniIlLcvwxhHosEFq]+|-[ABCm]\d*|-e|--(include|exclude|exclude-dir)=.+|--color=never)$/),
    takes: ["-A", "-B", "-C", "-m", "-e"],
  },
  rg: {
    ok: flags(/^(-[inwlcSsFvH]+|-[ABCmgt]\d*|-e|--(hidden|files|no-heading|line-number)|--(glob|type)=.+)$/),
    takes: ["-A", "-B", "-C", "-m", "-g", "-t", "-e"],
  },
  find: {
    ok: flags(/^-(name|iname|path|ipath|type|maxdepth|mindepth|empty|print|not|o|a)$/),
    takes: ["-name", "-iname", "-path", "-ipath", "-type", "-maxdepth", "-mindepth"],
  },
  // Only `sed -n 80,120p file`: other scripts can write or run commands.
  sed: { ok: flags(/^-n$/), script: /^\d+(,\d+)?p$/ },
};
READ_COMMANDS.egrep = READ_COMMANDS.grep;
READ_COMMANDS.fgrep = READ_COMMANDS.grep;

const GIT_READ = ["log", "show", "diff", "status", "ls-files", "rev-parse", "blame", "branch", "tag", "remote", "describe", "shortlog"];
const GIT_OPTIONS =
  /^(-[pnsv]|-\d+|-vv|--(oneline|stat|shortstat|numstat|name-only|name-status|graph|decorate|all|no-color|cached|staged|patch|reverse|abbrev-commit|no-merges|first-parent|summary|short|porcelain|show-current|list|others|modified)|--(pretty|format|since|until|after|before|author|max-count)=[^/]*)$/;

/** Splits a command line into plain words per simple command, with the operator before each; null when it is not plain. */
function plainCommands(command) {
  const text = String(command ?? "")
    .replace(/(^|[\s;&|])(\d|&)?>>?\s*\/dev\/null(?=$|[\s;&|])/g, "$1")
    .replace(/(^|[\s;&|])\d?>&\d(?=$|[\s;&|])/g, "$1");
  const commands = [{ joiner: null, words: [] }];
  let word = null;
  const end = () => {
    if (word !== null) commands[commands.length - 1].words.push(word);
    word = null;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'") {
      const close = text.indexOf("'", i + 1);
      if (close < 0) return null;
      const value = text.slice(i + 1, close);
      if (/[\n\r]/.test(value)) return null;
      word = (word ?? "") + value;
      i = close;
    } else if (c === '"') {
      const close = text.indexOf('"', i + 1);
      if (close < 0) return null;
      const value = text.slice(i + 1, close);
      // In double quotes the shell still expands `$`, backticks, `!` and escapes.
      if (/[$`\\!\n\r]/.test(value)) return null;
      word = (word ?? "") + value;
      i = close;
    } else if (c === " " || c === "\t") {
      end();
    } else if (c === ";" || c === "|" || c === "&") {
      end();
      let joiner = c;
      if ((c === "|" || c === "&") && text[i + 1] === c) joiner += text[++i];
      if (joiner === "&") return null;
      commands.push({ joiner, words: [] });
    } else if (PLAIN.test(c) && !(c === "=" && word === null)) {
      word = (word ?? "") + c;
    } else {
      return null;
    }
  }
  end();
  return commands.every((command) => command.words.length) ? commands : null;
}

/** Whether `args` only use options the command allows. */
function allowedArgs(name, args, gitRepo) {
  if (name === "git") {
    const [sub, ...rest] = args;
    // In a folder inside a larger repository, git would show the rest of it.
    if (!gitRepo || !GIT_READ.includes(sub)) return false;
    if (["branch", "tag", "remote"].includes(sub)) return rest.every((arg) => /^(-[arvl]|-vv|--(list|all|show-current))$/.test(arg));
    return rest.every((arg) => !arg.startsWith("-") || arg === "--" || GIT_OPTIONS.test(arg));
  }
  const rules = READ_COMMANDS[name];
  if (!rules) return false;
  let positional = 0;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("-") && arg !== "-") {
      if (!rules.ok(arg)) return false;
      if (rules.takes?.includes(arg)) i++;
    } else {
      if (rules.script && positional === 0 && !rules.script.test(arg)) return false;
      positional++;
    }
  }
  return !rules.positional || positional <= rules.positional;
}

/**
 * Whether a command only reads inside `root`: every simple command is a known
 * reading one with known options, and every other word, read as a path, stays
 * in the folder. `cd` may only come first, into an existing folder, with `&&`.
 */
export function isReadOnly(command, root) {
  const commands = plainCommands(command);
  if (!commands?.length) return false;
  const top = realPath(root);
  let cwd = top;
  let gitRepo = null;
  for (const [index, { words }] of commands.entries()) {
    const [name, ...args] = words;
    if (name === "cd") {
      if (index !== 0 || args.length !== 1 || commands[1]?.joiner !== "&&") return false;
      const target = args[0];
      if (target.startsWith("-") || target.startsWith("+") || target.split("/").includes("..")) return false;
      const next = realPath(resolve(cwd, target));
      if (!isInside(top, next) || !isDirectory(next)) return false;
      cwd = next;
      continue;
    }
    if (name === "git" && gitRepo === null) gitRepo = isGitTop(top);
    if (!allowedArgs(name, args, gitRepo)) return false;
    for (const arg of args) {
      // Option values were checked above; everything else may be a path.
      if (arg.startsWith("-")) continue;
      if (arg.split("/").includes("..")) return false;
      if (!isInside(top, realPath(resolve(cwd, arg)))) return false;
    }
  }
  return true;
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The project folder is the top of its git repository, not a folder inside a larger one. */
function isGitTop(root) {
  try {
    statSync(join(root, ".git"));
    return true;
  } catch {
    return false;
  }
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
  const planOnly = "Plan mode: only read and investigate, then present a plan. Do not change files or run commands other than reading ones.";
  // A second model's answer next to the chat's own (comparing models) never touches the folder.
  const readOnly = "This answer is compared with another model's; describe changes and commands instead of making them.";

  const check = async (input) => {
    const tool = input.tool_name;
    const current = mode();
    if (webTools.includes(tool) || tool === ARTIFACT_TOOL) return decide("allow");
    // Commands run in the project folder.
    if (RUN_TOOLS.includes(tool)) {
      // Looking around never needs an answer, also in Plan mode.
      if (isReadOnly(input.tool_input?.command, root)) return decide("allow");
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
