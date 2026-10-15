// Chat engine of Sienna. The Rust shell starts this script with Node
// and talks to it in JSON lines: commands on stdin, events on stdout.
//
// Every chat keeps one live Agent SDK query in streaming-input mode, so a
// follow-up message does not pay for a new Claude Code process. A chat whose
// query was closed (app restart, settings change) is picked up again with
// `resume` and its session id. Regenerating or editing the last exchange
// resumes the session cut back to the turn before it (`resumeSessionAt`).

import { deleteSession, query } from "@anthropic-ai/claude-agent-sdk";
import { createInterface } from "node:readline";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { READ_TOOLS, projectGuard, projectPrompt } from "./project.mjs";

const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
// The packaged app ships the engine as one bundled file plus the Claude Code
// binary next to it; in development the SDK finds the binary in node_modules.
// Absolute, because the engine runs Claude Code in its own working folder.
const claudeBinary = process.env.SIENNA_CLAUDE_BIN ? resolve(process.env.SIENNA_CLAUDE_BIN) : undefined;
const dataDir = process.env.CHAT_DATA_DIR ?? "";

// Without a key the SDK would quietly fall back to the Claude subscription
// login, which this app must never use.
// API keys come in several prefixes; an OAuth token would bill a subscription.
const isApiKey = apiKey.startsWith("sk-ant-") && !apiKey.startsWith("sk-ant-oat");
if (!isApiKey || !dataDir) {
  emit({ type: "fatal", message: "error.noKey" });
  process.exit(1);
}

// An own config dir keeps the user's Claude Code login, settings, hooks,
// plugins and memory out of the chat.
const configDir = join(dataDir, "claude-config");
const workDir = join(dataDir, "workspace");
mkdirSync(configDir, { recursive: true });
mkdirSync(workDir, { recursive: true });
// The SDK's session helpers (deleteSession) read the config dir from here.
process.env.CLAUDE_CONFIG_DIR = configDir;

const childEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LANG: process.env.LANG ?? "de_DE.UTF-8",
  TMPDIR: process.env.TMPDIR,
  ANTHROPIC_API_KEY: apiKey,
  CLAUDE_CONFIG_DIR: configDir,
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  CLAUDE_AGENT_SDK_CLIENT_APP: "sienna/0.1.0",
};

const SYSTEM_PROMPT = [
  "You are Claude, chatting in Sienna, a private chat app on the user's Mac.",
  "Always reply in the language the user writes in.",
  "Be clear and direct. Use Markdown where it helps reading, and code blocks with a language tag.",
  "When you search the web, cite the most important sources as links.",
].join("\n");

// Search only: WebFetch would let a page the model reads tell it to fetch an
// attacker's URL with parts of the conversation in it, unasked.
const WEB_TOOLS = ["WebSearch"];
const TITLE_MODEL = "claude-haiku-5-5";
const TITLE_PROMPT = [
  "You write titles for chats.",
  "Reply with the title only: at most six words, no quotation marks, no final period, in the language of the conversation.",
].join("\n");
const DELTA_FLUSH_MS = 32;
// Every live chat keeps a Claude Code process of its own. Idle chats are
// closed and picked up again with `resume` on their next message.
const MAX_LIVE_SESSIONS = 3;
const IDLE_CLOSE_MS = 10 * 60 * 1000;

/** @type {Map<string, ChatSession>} */
const sessions = new Map();

function emit(event) {
  process.stdout.write(JSON.stringify(event) + "\n");
}

// An async iterable the SDK reads user messages from; push() wakes it.
function createInbox() {
  const items = [];
  let wake = null;
  let closed = false;
  return {
    push(item) {
      items.push(item);
      wake?.();
      wake = null;
    },
    close() {
      closed = true;
      wake?.();
      wake = null;
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        while (items.length) yield items.shift();
        if (closed) return;
        await new Promise((resolve) => (wake = resolve));
      }
    },
  };
}

class ChatSession {
  constructor(chatId, config) {
    this.chatId = chatId;
    this.config = config;
    this.inbox = createInbox();
    // Cost already booked for this chat: a resumed query reports running
    // totals that include the earlier turns.
    this.costBase = config.costSoFar;
    this.turnHasText = false;
    this.pending = { text: "", thinking: "" };
    this.flushTimer = null;
    this.idleTimer = null;
    this.busy = false;
    this.interrupted = false;
    this.failReason = null;
    this.lastAssistantUuid = null;
    this.closed = false;
    this.query = query({
      prompt: this.inbox,
      options: {
        model: config.model,
        effort: config.effort,
        thinking: { type: "adaptive", display: "summarized" },
        includePartialMessages: true,
        settingSources: [],
        strictMcpConfig: true,
        tools: toolsFor(config),
        allowedTools: toolsFor(config),
        permissionMode: "dontAsk",
        hooks: config.projectDir ? projectGuard(config.projectDir, config.web ? WEB_TOOLS : []) : undefined,
        // Text is sent as typed: no `@path` file expansion, no slash commands.
        verbatimPrompts: true,
        systemPrompt: config.projectDir ? SYSTEM_PROMPT + projectPrompt(config.projectDir) : SYSTEM_PROMPT,
        cwd: config.projectDir ?? workDir,
        env: childEnv,
        pathToClaudeCodeExecutable: claudeBinary,
        resume: config.sessionId ?? undefined,
        // Cutting back forks the session, so the dropped turn stays out of it.
        resumeSessionAt: config.rewindTo ?? undefined,
        forkSession: config.rewindTo ? true : undefined,
        stderr: () => {},
      },
    });
    this.pump();
  }

  /** Shows paths inside the project folder relative to it. */
  relative(text) {
    const root = this.config.projectDir;
    return root && text.startsWith(root + "/") ? text.slice(root.length + 1) : text;
  }

  sameConfig(config) {
    return (
      this.config.effort === config.effort &&
      this.config.web === config.web &&
      this.config.projectDir === config.projectDir
    );
  }

  send(content) {
    clearTimeout(this.idleTimer);
    this.busy = true;
    this.interrupted = false;
    this.inbox.push({
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
    });
  }

  queueDelta(kind, text) {
    this.pending[kind] += text;
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), DELTA_FLUSH_MS);
  }

  flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const { text, thinking } = this.pending;
    if (!text && !thinking) return;
    this.pending = { text: "", thinking: "" };
    emit({ type: "delta", chatId: this.chatId, text, thinking });
  }

  handle(message) {
    if (message.parent_tool_use_id) return;
    switch (message.type) {
      case "system":
        if (message.subtype === "init") {
          // Belt and braces: never run a turn on anything but the API key.
          if (message.apiKeySource !== "ANTHROPIC_API_KEY") {
            this.failReason = "error.wrongCredential";
            this.close();
            return;
          }
          emit({ type: "session", chatId: this.chatId, sessionId: message.session_id });
          // After a rewind the old transcript still holds the dropped turn.
          const replaced = this.config.replacesSession;
          if (replaced && replaced !== message.session_id) {
            deleteSession(replaced, { dir: this.config.projectDir ?? workDir }).catch(() => {});
          }
        }
        return;
      case "stream_event": {
        const event = message.event;
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") this.queueDelta("text", event.delta.text);
          else if (event.delta.type === "thinking_delta") this.queueDelta("thinking", event.delta.thinking);
        } else if (event.type === "content_block_start" && event.content_block.type === "text") {
          // A text block after a web search continues the answer as a new paragraph.
          if (this.turnHasText) this.queueDelta("text", "\n\n");
          this.turnHasText = true;
        }
        return;
      }
      case "assistant":
        this.lastAssistantUuid = message.uuid;
        for (const block of message.message.content) {
          if (block.type !== "tool_use") continue;
          this.flush();
          const input = block.input ?? {};
          emit({
            type: "tool",
            chatId: this.chatId,
            name: block.name,
            detail: this.relative(String(input.query ?? input.url ?? input.pattern ?? input.file_path ?? "")),
          });
        }
        return;
      case "result": {
        this.flush();
        // total_cost_usd is a running total of this query; report the turn's share.
        const total = message.total_cost_usd ?? 0;
        const turnCost = total >= this.costBase ? total - this.costBase : total;
        this.costBase = total;
        this.turnHasText = false;
        this.busy = false;
        // A stopped answer ends with an error result; that is not a failure.
        const failed = message.is_error && !this.interrupted;
        emit({
          type: "done",
          chatId: this.chatId,
          sessionId: message.session_id,
          costUsd: turnCost,
          model: this.config.model,
          // Where a later rewind cuts back to, to drop the turns after this one.
          turnEnd: this.lastAssistantUuid,
          error: failed ? describeError(message) : null,
        });
        this.idleTimer = setTimeout(() => this.close(), IDLE_CLOSE_MS);
        return;
      }
      default:
        return;
    }
  }

  async pump() {
    let failure = null;
    try {
      for await (const message of this.query) this.handle(message);
    } catch (error) {
      failure = error;
    } finally {
      // The process ended in the middle of an answer: the UI must not wait for it.
      if (this.busy) {
        this.busy = false;
        this.flush();
        const error = this.interrupted
          ? null
          : (this.failReason ?? (failure ? describeError(failure) : "error.interrupted"));
        emit({ type: "done", chatId: this.chatId, costUsd: 0, error });
      }
      clearTimeout(this.idleTimer);
      if (sessions.get(this.chatId) === this) sessions.delete(this.chatId);
    }
  }

  async interrupt() {
    this.interrupted = true;
    try {
      await this.query.interrupt();
    } catch {
      this.close();
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.idleTimer);
    this.flush();
    this.inbox.close();
    try {
      this.query.close();
    } catch {
      // Already gone.
    }
  }
}

/** Maps a failure to an error code; the window translates it (src/i18n.ts). */
function describeError(source) {
  const raw =
    source?.errors?.join(" ") ?? source?.result ?? source?.message ?? String(source ?? "");
  const status = source?.api_error_status ?? 0;
  if (status === 401 || /invalid api key|authentication/i.test(raw)) return "error.keyRejected";
  if (/usage limit|spend limit|credit balance/i.test(raw)) return "error.creditExhausted";
  if (status === 429 || /rate limit/i.test(raw)) return "error.rateLimited";
  if (status === 529 || /overloaded/i.test(raw)) return "error.overloaded";
  return "error.answerFailed";
}

/** A file name that cannot break out of the tag it is written into. */
function safeName(name) {
  return String(name ?? "file").replace(/[^\p{L}\p{N} ._()+-]/gu, "_").slice(0, 120) || "file";
}

function toBlock(file) {
  if (file.mediaType === "text/plain") {
    // Text files go in as text, so Claude reads them directly and knows the file name.
    return { type: "text", text: `<file name="${safeName(file.name)}">\n${file.data}\n</file>` };
  }
  const source = { type: "base64", media_type: file.mediaType, data: file.data };
  return file.mediaType === "application/pdf" ? { type: "document", source } : { type: "image", source };
}

function toContent(text, attachments) {
  if (!attachments?.length) return text;
  const blocks = attachments.map(toBlock);
  if (text) blocks.push({ type: "text", text });
  return blocks;
}

function toolsFor(config) {
  return [...(config.projectDir ? READ_TOOLS : []), ...(config.web ? WEB_TOOLS : [])];
}

async function onSend(command) {
  const config = {
    model: command.model,
    effort: command.effort,
    web: Boolean(command.web),
    sessionId: command.sessionId ?? null,
    costSoFar: Number(command.costSoFar) || 0,
    // Already checked and made canonical by the Rust shell.
    projectDir: typeof command.projectDir === "string" && command.projectDir ? command.projectDir : null,
    rewindTo: null,
    replacesSession: null,
  };
  let session = sessions.get(command.chatId);
  if (command.rewind) {
    // Regenerate or edit: the answer to replace is the last turn of the
    // session. Keep everything up to `rewindTo`; without one, start afresh.
    session?.close();
    sessions.delete(command.chatId);
    session = undefined;
    config.replacesSession = config.sessionId;
    config.rewindTo = command.rewindTo ?? null;
    if (!config.rewindTo) config.sessionId = null;
  }
  if (session && !session.sameConfig(config)) {
    session.close();
    sessions.delete(command.chatId);
    session = undefined;
  }
  if (!session) {
    evictIdleSessions();
    session = new ChatSession(command.chatId, config);
  } else if (session.config.model !== config.model) {
    session.config.model = config.model;
    await session.query.setModel(config.model);
  }
  // Re-inserting keeps the map ordered from least to most recently used.
  sessions.delete(command.chatId);
  sessions.set(command.chatId, session);
  session.send(toContent(command.text, command.attachments));
}

/** Makes room for one more live session by closing the oldest idle ones. */
function evictIdleSessions() {
  for (const [chatId, session] of sessions) {
    if (sessions.size < MAX_LIVE_SESSIONS) return;
    if (session.busy) continue;
    session.close();
    sessions.delete(chatId);
  }
}

/** Asks Haiku for a short chat title, in a one-shot query that is not kept. */
async function onTitle(command) {
  const titleQuery = query({
    prompt: String(command.text ?? "").slice(0, 4000),
    options: {
      model: TITLE_MODEL,
      effort: "low",
      maxTurns: 1,
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
      permissionMode: "dontAsk",
      persistSession: false,
      verbatimPrompts: true,
      systemPrompt: TITLE_PROMPT,
      cwd: workDir,
      env: childEnv,
      pathToClaudeCodeExecutable: claudeBinary,
      stderr: () => {},
    },
  });
  for await (const message of titleQuery) {
    if (message.type === "system" && message.subtype === "init" && message.apiKeySource !== "ANTHROPIC_API_KEY") {
      titleQuery.close();
      return;
    }
    if (message.type !== "result") continue;
    const title = String(message.result ?? "")
      .split("\n")[0]
      .replace(/^["'„“»«\s]+|["'„“»«.\s]+$/g, "")
      .slice(0, 60);
    emit({
      type: "title",
      chatId: command.chatId,
      title: message.is_error ? "" : title,
      costUsd: message.total_cost_usd ?? 0,
      model: TITLE_MODEL,
    });
  }
}

function onCommand(line) {
  let command;
  try {
    command = JSON.parse(line);
  } catch {
    return;
  }
  switch (command.type) {
    case "send":
      onSend(command).catch((error) =>
        emit({ type: "done", chatId: command.chatId, costUsd: 0, error: describeError(error) }),
      );
      return;
    case "interrupt":
      sessions.get(command.chatId)?.interrupt();
      return;
    case "title":
      onTitle(command).catch(() => {});
      return;
    case "close":
      sessions.get(command.chatId)?.close();
      sessions.delete(command.chatId);
      return;
    default:
      return;
  }
}

createInterface({ input: process.stdin }).on("line", onCommand).on("close", () => {
  for (const session of sessions.values()) session.close();
  process.exit(0);
});

emit({ type: "ready" });
