// Project mode: Claude works in one folder the user picked, and nowhere else.
// Reading and searching run freely. Whether a change or a command needs the
// user's approval (`canUseTool` in index.mjs) depends on the chat's mode, as
// in Claude Code. A PreToolUse hook checks every tool call before it runs, so
// the folder limit and the always-ask commands hold in every mode.

import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

export const READ_TOOLS = ["Read", "Grep", "Glob"];
export const EDIT_TOOLS = ["Edit", "Write"];
export const RUN_TOOLS = ["Bash"];
export const MODES = ["auto", "default", "acceptEdits", "plan", "bypassPermissions"];

// Commands that ask first in every mode, also when permissions are bypassed.
const RISKY_COMMANDS = [
  /\bsudo\b/,
  /\brm\s+(-\w+\s+)*-\w*(r\w*f|f\w*r)/i,
  /\brm\s+(-\w+\s+)*-\w*r\b.*\s-\w*f/i,
  /\bgit\s+push\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-\w*f/,
  /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/,
  /\bmkfs\b|\bdd\s+if=/,
];

export function isRisky(command) {
  return RISKY_COMMANDS.some((pattern) => pattern.test(String(command ?? "")));
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

  const check = async (input) => {
    const tool = input.tool_name;
    const current = mode();
    if (webTools.includes(tool)) return decide("allow");
    // Commands run in the project folder.
    if (RUN_TOOLS.includes(tool)) {
      if (current === "plan") return deny(planOnly);
      if (isRisky(input.tool_input?.command)) return decide("ask");
      if (current === "bypassPermissions") return decide("allow");
      return current === "auto" ? undecided : decide("ask");
    }
    const editing = EDIT_TOOLS.includes(tool);
    if (!READ_TOOLS.includes(tool) && !editing) return deny("This tool is not available in Sienna.");
    const target = targetOf(tool, input.tool_input);
    const absolute = isAbsolute(target) ? target : resolve(root, target);
    const real = realPath(absolute);
    if (!isInside(root, real)) return deny("This path is outside the project folder.");
    if (!editing) return decide("allow");
    // Git's own files (hooks among them) are never written by Claude.
    if (isInside(join(root, ".git"), real)) return deny("Files in .git cannot be changed.");
    if (current === "plan") return deny(planOnly);
    if (current === "default") return decide("ask");
    onEdit(tool, input.tool_input ?? {}, input.tool_use_id ?? null);
    return decide("allow");
  };

  return { PreToolUse: [{ hooks: [check] }] };
}

/** The project's CLAUDE.md, read here rather than through Claude Code's settings, which could run hooks. */
export function projectInstructions(projectDir) {
  for (const name of ["CLAUDE.md", ".claude/CLAUDE.md"]) {
    try {
      const text = readFileSync(join(projectDir, name), "utf8");
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
    lines.push("", "The project's CLAUDE.md:", "<project_instructions>", instructions, "</project_instructions>");
  }
  return lines.join("\n");
}
