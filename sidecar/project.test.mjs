// The project folder is a security boundary: Claude may read inside it and
// nowhere else. Run with `npm test`.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { projectGuard, projectPrompt } from "./project.mjs";

const base = mkdtempSync(join(tmpdir(), "sienna-guard-"));
const root = join(base, "acme");
mkdirSync(join(root, "src"), { recursive: true });
mkdirSync(join(base, "outside"));
writeFileSync(join(root, "src", "main.rs"), "fn main() {}\n");
writeFileSync(join(base, "outside", "key.txt"), "secret\n");
writeFileSync(join(root, "CLAUDE.md"), "# Quokka rules\n");
symlinkSync(join(base, "outside"), join(root, "link"));
after(() => rmSync(base, { recursive: true, force: true }));

const check = projectGuard(root, ["WebSearch"]).PreToolUse[0].hooks[0];

test("allows reading and searching inside the project folder only", async () => {
  const cases = [
    ["Read", { file_path: join(root, "src", "main.rs") }, "allow"],
    ["Read", { file_path: "src/main.rs" }, "allow"],
    ["Grep", { pattern: "fn" }, "allow"],
    ["Glob", { pattern: "**/*.rs", path: join(root, "src") }, "allow"],
    ["WebSearch", { query: "tauri" }, "allow"],
    ["Read", { file_path: join(base, "outside", "key.txt") }, "deny"],
    ["Read", { file_path: join(root, "..", "outside", "key.txt") }, "deny"],
    ["Read", { file_path: join(root, "link", "key.txt") }, "deny"],
    ["Glob", { pattern: "*", path: join(root, "link") }, "deny"],
    ["Grep", { pattern: "root", path: "/etc" }, "deny"],
    ["Bash", { command: "ls" }, "deny"],
    ["Write", { file_path: join(root, "new.txt"), content: "x" }, "deny"],
    ["Edit", { file_path: join(root, "src", "main.rs") }, "deny"],
  ];
  for (const [tool, input, expected] of cases) {
    const result = await check({ tool_name: tool, tool_input: input });
    assert.equal(result.hookSpecificOutput.permissionDecision, expected, `${tool} ${JSON.stringify(input)}`);
  }
});

test("puts the project's CLAUDE.md into the prompt", () => {
  assert.match(projectPrompt(root), /# Quokka rules/);
});
