// Project mode: Claude may read and search the files of one folder the user
// picked, and nothing else. A PreToolUse hook checks every tool call before it
// runs, so the limit holds even if a tool would otherwise be allowed.

import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

export const READ_TOOLS = ["Read", "Grep", "Glob"];
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

/** The path a read tool call touches; Grep and Glob default to the project folder. */
function targetOf(toolName, input) {
  const raw = toolName === "Read" ? input?.file_path : input?.path;
  return typeof raw === "string" && raw ? raw : ".";
}

/**
 * Hook options that allow only the read tools (plus web search when it is on)
 * and only on paths inside `projectDir`.
 */
export function projectGuard(projectDir, webTools) {
  const root = realPath(projectDir);
  const deny = (reason) => ({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  });
  const allow = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } };

  const check = async (input) => {
    const tool = input.tool_name;
    if (webTools.includes(tool)) return allow;
    if (!READ_TOOLS.includes(tool)) return deny("Only reading and searching the project folder is allowed.");
    const target = targetOf(tool, input.tool_input);
    const absolute = isAbsolute(target) ? target : resolve(root, target);
    if (!isInside(root, realPath(absolute))) return deny("This path is outside the project folder.");
    return allow;
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
    "You can read and search files in this folder with Read, Grep and Glob. You cannot change files or run commands; say so if asked.",
    "Answer from the code: cite files with their path relative to the project folder and line numbers where it helps.",
  ];
  const instructions = projectInstructions(projectDir);
  if (instructions) {
    lines.push("", "The project's CLAUDE.md:", "<project_instructions>", instructions, "</project_instructions>");
  }
  return lines.join("\n");
}
