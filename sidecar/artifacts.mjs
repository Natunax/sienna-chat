// Artifacts, as in Claude: a standalone piece of work (a small web app, an
// SVG, a document, a code file) that the window shows next to the chat. Claude
// creates and updates one through this tool; the same id makes a new version.
// The window renders HTML and SVG in a sealed frame (`src-tauri/src/artifact.rs`).

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export const ARTIFACT_SERVER = "sienna";
export const ARTIFACT_TOOL = `mcp__${ARTIFACT_SERVER}__artifact`;
export const ARTIFACT_KINDS = ["html", "svg", "markdown", "code"];
const MAX_CONTENT_CHARS = 300_000;

export const ARTIFACT_PROMPT = [
  "",
  "<artifacts>",
  "You can show the user an artifact next to the chat with the `artifact` tool: a standalone, self-contained piece of work they will look at, reuse or change, such as a small web app or tool (html), a diagram or graphic (svg), a longer document (markdown) or a complete code file (code).",
  "Use it for substantial content (roughly more than 20 lines) that stands on its own. Do not use it for short snippets, explanations or answers to questions; those belong in the chat.",
  "To change an artifact, call the tool again with the same id and the complete new content; each call is a new version. Keep ids short and stable, like `budget-calculator`.",
  "HTML artifacts are one complete file with inline CSS and JavaScript. They run sealed: no network, no storage, no forms that submit anywhere. Scripts and styles may only come inline or from https://cdnjs.cloudflare.com.",
  "After the tool call, say in one or two sentences what you made; do not repeat the content in the chat.",
  "</artifacts>",
].join("\n");

/** The tool's server for one chat; `onArtifact` hears each new version. */
export function artifactServer(onArtifact) {
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
          return { content: [{ type: "text", text: `Artifact "${args.id}" is shown to the user.` }] };
        },
      ),
    ],
  });
}
