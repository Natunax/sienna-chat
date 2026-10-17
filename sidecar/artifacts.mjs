// Artifacts, as in Claude: a standalone piece of work (a small web app, an
// SVG, a document, a code file) that the window shows next to the chat. Claude
// creates and updates one through this tool; the same id makes a new version.
// The window renders HTML and SVG in a sealed frame (`src-tauri/src/artifact.rs`).

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { spawn } from "node:child_process";
import { z } from "zod";

export const ARTIFACT_SERVER = "sienna";
export const ARTIFACT_TOOL = `mcp__${ARTIFACT_SERVER}__artifact`;
export const ARTIFACT_VIEW_TOOL = `mcp__${ARTIFACT_SERVER}__artifact_view`;
/** What a model sees of its HTML and SVG: a desktop view, unless it asks for another. */
const DEFAULT_VIEW = { width: 1280, height: 800 };
const SNAPSHOT_TIMEOUT_MS = 25_000;

/** An SVG on its own page, centered on white, as the panel shows it. */
function pageOf(kind, content) {
  return kind === "svg"
    ? `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}body{display:grid;place-items:center;background:#fff}svg{max-width:100%;max-height:100vh}</style></head><body>${content}</body></html>`
    : content;
}

/**
 * The page rendered by the snapshot helper (`src-tauri/snapshot`), as a PNG in
 * base64; null when the helper is missing or the page does not render.
 */
function snapshot(kind, content, { width, height, fullPage }) {
  const helper = process.env.SIENNA_SNAPSHOT_BIN;
  if (!helper) return Promise.resolve(null);
  return new Promise((done) => {
    const child = spawn(helper, [String(width), String(height), fullPage ? "1" : "0"], {
      env: {},
      stdio: ["pipe", "pipe", "ignore"],
    });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), SNAPSHOT_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("error", () => done(null));
    child.on("close", (code) => {
      clearTimeout(timer);
      done(code === 0 && out ? out.trim() : null);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(pageOf(kind, content));
  });
}

/** A tool result with the rendered page, so the model can check its work. */
async function looked(text, kind, content, view) {
  const image = kind === "html" || kind === "svg" ? await snapshot(kind, content, view) : null;
  const note = image
    ? ` Below is how it renders at ${view.width}×${view.height}${view.fullPage ? " (full page)" : ""}. Check it; if something is off, fix it with another artifact call.`
    : "";
  return {
    content: [
      { type: "text", text: text + note },
      ...(image ? [{ type: "image", data: image, mimeType: "image/png" }] : []),
    ],
  };
}
export const ARTIFACT_KINDS = ["html", "svg", "markdown", "code"];
const MAX_CONTENT_CHARS = 300_000;

export const ARTIFACT_PROMPT = [
  "",
  "<artifacts>",
  "You can show the user an artifact next to the chat with the `artifact` tool: a standalone, self-contained piece of work they will look at, reuse or change, such as a small web app or tool (html), a diagram or graphic (svg), a longer document (markdown) or a complete code file (code).",
  "Use it for substantial content (roughly more than 20 lines) that stands on its own. Do not use it for short snippets, explanations or answers to questions; those belong in the chat.",
  "To change an artifact, call the tool again with the same id and the complete new content; each call is a new version. Keep ids short and stable, like `budget-calculator`.",
  "HTML artifacts are one complete file with inline CSS and JavaScript. They run sealed: no network, no storage, no forms that submit anywhere. Scripts and styles may only come inline or from https://cdnjs.cloudflare.com.",
  "After an html or svg artifact call you get a screenshot of how it renders. Look at it and fix what is broken, cut off or ugly before you answer. With `artifact_view` you can look again at another size, for example 390×844 for a phone or the full page.",
  "After the tool call, say in one or two sentences what you made; do not repeat the content in the chat.",
  "</artifacts>",
].join("\n");

/** The tool's server for one chat; `onArtifact` hears each new version. */
export function artifactServer(onArtifact) {
  // This session's artifacts, newest version by id, for `artifact_view`.
  const latest = new Map();
  return createSdkMcpServer({
    name: ARTIFACT_SERVER,
    version: "1.0.0",
    tools: [
      tool(
        "artifact",
        "Create or update an artifact shown next to the chat. Calling it again with the same id replaces the content as a new version.",
        {
          id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).describe("Short stable id in kebab-case, e.g. budget-calculator"),
          title: z.string().min(1).max(80).describe("A short title for the user"),
          kind: z.enum(ARTIFACT_KINDS).describe("html, svg, markdown or code"),
          language: z.string().max(30).optional().describe("For kind code: the language, e.g. python"),
          content: z.string().min(1).max(MAX_CONTENT_CHARS).describe("The complete content"),
        },
        async (args) => {
          onArtifact({
            id: args.id,
            title: args.title,
            kind: args.kind,
            language: args.kind === "code" ? (args.language ?? "").slice(0, 30) : undefined,
            content: args.content,
          });
          latest.set(args.id, { kind: args.kind, content: args.content });
          return looked(`Artifact "${args.id}" is shown to the user.`, args.kind, args.content, DEFAULT_VIEW);
        },
      ),
      tool(
        "artifact_view",
        "Look at an html or svg artifact of this conversation as it renders, at a size of your choice, to check your work.",
        {
          id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).describe("The artifact's id"),
          width: z.number().int().min(200).max(2400).optional().describe("View width in CSS pixels, default 1280 (390 for a phone)"),
          height: z.number().int().min(200).max(2400).optional().describe("View height, default 800 (844 for a phone)"),
          full_page: z.boolean().optional().describe("Capture the whole page height (up to 4000 px)"),
        },
        async (args) => {
          const known = latest.get(args.id);
          if (!known) {
            return { content: [{ type: "text", text: `No artifact "${args.id}" in this session yet; create or update it first.` }] };
          }
          const view = {
            width: args.width ?? DEFAULT_VIEW.width,
            height: args.height ?? DEFAULT_VIEW.height,
            fullPage: Boolean(args.full_page),
          };
          return looked(`Artifact "${args.id}".`, known.kind, known.content, view);
        },
      ),
    ],
  });
}
