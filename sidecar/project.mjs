// Project mode: Claude works in one folder the user picked, and nowhere else.
// Reading and searching run freely; changing a file or running a command
// needs the user's approval each time (`canUseTool` in index.mjs). A PreToolUse
// hook checks every tool call before it runs, so the limits hold even if a
// tool would otherwise be allowed.

import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

export const READ_TOOLS = ["Read", "Grep", "Glob"];
export const EDIT_TOOLS = ["Edit", "Write"];
export const RUN_TOOLS = ["Bash"];
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
 * paths inside `projectDir`, hand changes inside it and commands to the user
 * for approval ("ask"), and deny everything else.
 */
export function projectGuard(projectDir, webTools) {
  const root = realPath(projectDir);
  const deny = (reason) => ({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  });
  const decide = (decision) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision } });

  const check = async (input) => {
    const tool = input.tool_name;
    if (webTools.includes(tool)) return decide("allow");
    // Commands run in the project folder; the user sees each one before it runs.
    if (RUN_TOOLS.includes(tool)) return decide("ask");
    const editing = EDIT_TOOLS.includes(tool);
    if (!READ_TOOLS.includes(tool) && !editing) return deny("This tool is not available in Sienna.");
    const target = targetOf(tool, input.tool_input);
    const absolute = isAbsolute(target) ? target : resolve(root, target);
    const real = realPath(absolute);
    if (!isInside(root, real)) return deny("This path is outside the project folder.");
    // Git's own files (hooks among them) are never written by Claude.
    if (editing && isInside(join(root, ".git"), real)) return deny("Files in .git cannot be changed.");
    return decide(editing ? "ask" : "allow");
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
    "The user sees and approves every change and every command before it runs. Make focused changes, and say in one line what a command is for.",
    "If the user declines a change or command, do not try it another way; ask how they want to go on.",
    "Answer from the code: cite files with their path relative to the project folder and line numbers where it helps.",
  ];
  const instructions = projectInstructions(projectDir);
  if (instructions) {
    lines.push("", "The project's CLAUDE.md:", "<project_instructions>", instructions, "</project_instructions>");
  }
  return lines.join("\n");
}
