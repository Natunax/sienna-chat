// Chat engine of Sienna. The Rust shell starts this script with Node
// and talks to it in JSON lines: commands on stdin, events on stdout.
//
// Every chat keeps one live Agent SDK query in streaming-input mode, so a
// follow-up message does not pay for a new Claude Code process. A chat whose
// query was closed (app restart, settings change) is picked up again with
// `resume` and its session id. Regenerating or editing the last exchange
// resumes the session cut back to the turn before it (`resumeSessionAt`).
//
// In a project chat Claude may also change files and run commands. The chat's
// mode (auto, manual, accept edits, plan, bypass) decides which calls need the
// user's approval; those wait in `canUseTool` until the user answers in the
// window (a "permission" event out, a "permission" command back).

import { deleteSession, query } from "@anthropic-ai/claude-agent-sdk";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { EDIT_TOOLS, MODES, READ_TOOLS, RUN_TOOLS, isReadOnly, isRisky, projectGuard, projectPrompt } from "./project.mjs";
import { TEMPLATES } from "./templates.mjs";
import { ARTIFACT_PROMPT, ARTIFACT_TOOL, ARTIFACT_VIEW_TOOL, artifactServer } from "./artifacts.mjs";

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

// Commands Claude runs in a project need the usual developer tools; a GUI
// app's PATH has none of them.
const home = process.env.HOME ?? "";
const toolPath = [
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  `${home}/.cargo/bin`,
  `${home}/.local/bin`,
  `${home}/.volta/bin`,
  process.env.PATH,
]
  .filter(Boolean)
  .join(":");

const childEnv = {
  PATH: toolPath,
  HOME: process.env.HOME,
  LANG: process.env.LANG ?? "de_DE.UTF-8",
  TMPDIR: process.env.TMPDIR,
  ANTHROPIC_API_KEY: apiKey,
  CLAUDE_CONFIG_DIR: configDir,
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  CLAUDE_AGENT_SDK_CLIENT_APP: "sienna/0.1.0",
  // Commands Claude runs (Bash, hooks) get an environment without the API key;
  // only Claude Code itself keeps it for its requests.
  CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1",
};

// Never readable by sandboxed commands: credentials, shell history and
// Sienna's own data (chats, transcripts).
const PRIVATE_PATHS = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".config/gh",
  ".config/gcloud",
  ".docker",
  ".kube",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".git-credentials",
  ".zsh_history",
  ".bash_history",
  ".claude",
  "Library/Keychains",
  "Library/Cookies",
  // Other apps' data and tokens, synced documents, shell start-up files with exported secrets.
  "Library/Application Support",
  "Library/Containers",
  "Library/Group Containers",
  "Library/Mobile Documents",
  "Library/Mail",
  "Library/Messages",
  "Library/Safari",
  ".zshrc",
  ".zprofile",
  ".zshenv",
  ".bashrc",
  ".bash_profile",
  ".profile",
].map((path) => join(home, path));
// Working copies of every project a second model answered in (`workcopy.rs`);
// a session working in one of them may still read its own.
const COPIES_DIR = process.env.SIENNA_COPIES_DIR || null;

/** API keys in text that leaves the engine (command output, check output), masked. */
function maskSecrets(text) {
  return String(text ?? "").replace(/sk-ant-[A-Za-z0-9_-]{6,}/g, "sk-ant-…");
}

const SYSTEM_PROMPT = [
  "You are Claude, chatting in Sienna, a private chat app on the user's Mac.",
  "Always reply in the language the user writes in.",
  "Be clear and direct. Use Markdown where it helps reading, and code blocks with a language tag.",
  "When you search the web, cite the most important sources as links.",
].join("\n");

// Subagents, as in Claude Code: Claude may hand parts of a task to helpers
// (the SDK's own, such as general-purpose and Explore). Each of their calls
// passes the same guard and asks for the same approvals as Claude's own.
// Ultracode adds two read-only helpers of Sienna's and tells Claude to use
// them in parallel.
const AGENT_TOOLS = ["Agent", "Task"];
const ULTRA_PROMPT = [
  "",
  "<sienna_ultracode>",
  "The user chose Ultracode: be as thorough as you can, cost is secondary.",
  "For any substantial task, split it into independent parts and hand them to helpers with the Agent tool, several calls in one message so they run at the same time:",
  "- `researcher` for one part to investigate (code, sources, options); give it a precise brief.",
  "- `verifier` to try to refute a finding, plan or result before you rely on it; act on what it refutes.",
  "Helpers only look and report; you make every change, run every command and write the final answer yourself.",
  "Do not use helpers for small questions or quick edits.",
  "</sienna_ultracode>",
].join("\n");

/**
 * Ultracode runs at the highest effort the API knows. Its helpers need
 * something to look at, a project folder or web search; without either it is
 * the highest effort alone.
 */
function isUltra(config) {
  return config.effort === "ultracode" && Boolean(config.projectDir || config.web) && !config.format;
}

function sdkEffort(effort) {
  return effort === "ultracode" ? "max" : effort;
}

/** The helpers Ultracode may start; read-only in a project, search-only on the web. */
function ultraAgents(config) {
  const tools = [...(config.projectDir ? READ_TOOLS : []), ...(config.web ? WEB_TOOLS : [])];
  const common = "Report concisely with evidence (file paths and lines, or source links). Never claim more than you checked.";
  const agents = {
    researcher: {
      description: "Investigates one independent part of the task in depth and reports what it found.",
      prompt: `You investigate one part of a larger task for Claude, who briefed you. ${common}`,
      tools,
      model: "inherit",
      background: false,
    },
    verifier: {
      description: "Tries to refute a finding, plan or result; reports whether it holds and why.",
      prompt: `You are an adversarial reviewer. Try hard to prove the claim you are given wrong; default to doubt when the evidence is thin. ${common}`,
      tools,
      model: "inherit",
      background: false,
    },
  };
  return agents;
}

// Search only: WebFetch would let a page the model reads tell it to fetch an
// attacker's URL with parts of the conversation in it, unasked.
const WEB_TOOLS = ["WebSearch"];
const TITLE_MODEL = "claude-haiku-5-5";
const TITLE_PROMPT = [
  "You write titles for chats.",
  "Reply with the title only: at most six words, no quotation marks, no final period, in the language of the conversation.",
].join("\n");
const DELTA_FLUSH_MS = 32;
// How long after an answer a message sent into it may still start its own.
const STEER_WAIT_MS = 2500;
// What an approval card and a stored change show at most, per side.
const MAX_CHANGE_CHARS = 200_000;
const MAX_OUTPUT_CHARS = 8000;
// Sienna's plan mode is its own: Claude Code runs in manual mode, the guard
// denies changes and commands, and each message carries this instruction.
const PLAN_NOTE = [
  "<sienna_plan_mode>",
  "The user switched on plan mode. Read and investigate the project, but do not change files or run commands.",
  "End your answer with a concrete, numbered plan of the changes you would make, naming the files.",
  "</sienna_plan_mode>",
].join("\n");
// Auto mode's model checks and bypassing run commands in macOS's sandbox,
// which keeps their writes in the project folder.
const SANDBOXED_MODES = ["auto", "bypassPermissions"];

function needsSandbox(config) {
  return Boolean(config.projectDir && SANDBOXED_MODES.includes(config.mode));
}

/** What sandboxed commands may never read; a session in a working copy keeps its own. */
function privateFor(projectDir) {
  const paths = [...PRIVATE_PATHS, dataDir];
  if (COPIES_DIR) {
    const own = projectDir && projectDir.startsWith(COPIES_DIR + "/");
    if (!own) paths.push(COPIES_DIR);
  }
  return paths;
}
/**
 * The setting "approve automatically": on top of every mode, Sienna answers
 * each approval as if the user clicked Allow. Destructive commands still ask.
 */
let autoApprove = false;
const autoApproves = (tool, input) => autoApprove && !(RUN_TOOLS.includes(tool) && isRisky(input?.command));

/** Models known to lack auto mode, learned from the SDK. */
const noAutoMode = new Set();

function sdkMode(mode) {
  return mode === "plan" || mode === "readonly" ? "default" : mode;
}

// The check command after changes: how often a failing check sends Claude
// back to fix it within one answer, and how long it may run.
const MAX_CHECK_ROUNDS = 2;
const CHECK_TIMEOUT_MS = 10 * 60 * 1000;
const REVERTED_NOTE =
  "<sienna_note>The user reverted the file changes of an earlier answer in Sienna. The files are back to how they were before it; read them again before relying on them.</sienna_note>";

/**
 * Runs the user's check command in the project folder; resolves with its
 * result. Stopping (`signal`) ends it with everything it started.
 */
function runCheck(command, cwd, signal) {
  return new Promise((resolveCheck) => {
    // The API key stays out of the user's tests.
    const { ANTHROPIC_API_KEY: _key, CLAUDE_CONFIG_DIR: _config, CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: _scrub, ...env } = childEnv;
    // Its own process group, so test runners and their children stop together.
    const child = spawn("/bin/zsh", ["-c", command], { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    const stop = () => {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    };
    signal?.addEventListener("abort", stop, { once: true });
    let output = "";
    const collect = (chunk) => {
      output = (output + chunk.toString()).slice(-MAX_OUTPUT_CHARS * 4);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(stop, CHECK_TIMEOUT_MS);
    const finish = (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      resolveCheck({ passed: code === 0, output: maskSecrets(output.slice(-MAX_OUTPUT_CHARS)) });
    };
    child.on("error", () => finish(-1));
    child.on("close", finish);
  });
}

function validMode(mode) {
  return MODES.includes(mode) ? mode : "auto";
}
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

/**
 * Claude Code keeps a session's transcript under a folder named after its
 * working directory. A second model's answer works in a copy of the project,
 * and a branch of it goes back to the project: the transcript moves along.
 */
function ensureSession(sessionId, cwd) {
  if (!sessionId) return;
  const projects = join(configDir, "projects");
  const target = join(projects, cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  const file = `${sessionId}.jsonl`;
  if (existsSync(join(target, file))) return;
  try {
    const from = readdirSync(projects).find((dir) => existsSync(join(projects, dir, file)));
    if (!from) return;
    mkdirSync(target, { recursive: true });
    copyFileSync(join(projects, from, file), join(target, file));
  } catch {
    // Resuming then starts a fresh session, as for a lost transcript.
  }
}

class ChatSession {
  constructor(chatId, config) {
    ensureSession(config.sessionId, config.projectDir ?? workDir);
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
    this.compacting = false;
    this.compactFailed = false;
    this.keptAssistantUuid = null;
    this.lastAssistantUuid = null;
    this.closed = false;
    /** Approvals the window still has to answer, by request id. */
    this.permissions = new Map();
    /** Commands' tool use ids, to report their output. */
    this.commandIds = new Set();
    /** Files changed in the running answer, those changed without asking, and check rounds run for it. */
    this.edited = false;
    this.unasked = new Set();
    /** Commands that ran in the sandbox without asking; they can change what the check runs. */
    this.unaskedCommands = [];
    this.sandboxed = needsSandbox(config);
    /** Messages sent into the running answer that Claude has not taken in yet, by uuid. */
    this.steers = new Set();
    /** After an answer that left some of them: waits whether they start an answer of their own. */
    this.steerWait = null;
    this.checkRounds = 0;
    /** Stops a running check when the answer is stopped. */
    this.checkStop = null;
    this.query = query({
      prompt: this.inbox,
      options: {
        model: config.model,
        effort: sdkEffort(config.effort),
        thinking: { type: "adaptive", display: "summarized" },
        includePartialMessages: true,
        settingSources: [],
        strictMcpConfig: true,
        tools: toolsFor(config),
        // Changes and commands are not pre-approved: they go to canUseTool.
        allowedTools: allowedFor(config),
        permissionMode: config.projectDir ? sdkMode(config.mode) : "dontAsk",
        // Lets the user switch to bypassing later; the guard still holds.
        allowDangerouslySkipPermissions: config.projectDir ? true : undefined,
        sandbox: this.sandboxed
            ? {
                enabled: true,
                // Without the sandbox these modes would run commands unchecked; better to fail.
                failIfUnavailable: true,
                autoAllowBashIfSandboxed: false,
                allowUnsandboxedCommands: false,
                network: { allowLocalBinding: true },
                filesystem: { denyRead: privateFor(config.projectDir) },
              }
            : undefined,
        canUseTool: config.projectDir ? (tool, input, options) => this.askUser(tool, input, options) : undefined,
        hooks: config.projectDir
          ? {
              ...projectGuard(config.projectDir, config.web ? WEB_TOOLS : [], {
                mode: () => this.effectiveMode(),
                onEdit: (tool, input, toolUseId) => {
                  this.edited = true;
                  this.unasked.add(this.relative(String(input.file_path ?? "")));
                  emit({ type: "change", chatId: this.chatId, id: randomUUID(), toolUseId, ...this.describe(tool, input) });
                },
              }),
              Stop: [{ hooks: [(_input, _id, options) => this.afterAnswer(options?.signal)] }],
            }
          : undefined,
        // Backups of changed files, so an answer's changes can be undone.
        enableFileCheckpointing: config.projectDir ? true : undefined,
        outputFormat: config.format ? { type: "json_schema", schema: TEMPLATES[config.format] } : undefined,
        systemPrompt:
          (config.projectDir ? SYSTEM_PROMPT + projectPrompt(config.projectDir) : SYSTEM_PROMPT) +
          (artifactsFor(config) ? ARTIFACT_PROMPT : "") +
          (isUltra(config) ? ULTRA_PROMPT : ""),
        agents: isUltra(config) ? ultraAgents(config) : undefined,
        // The artifact tool runs in this process and only reports to the window.
        mcpServers: artifactsFor(config)
          ? {
              sienna: artifactServer((artifact) => {
                this.flush();
                emit({ type: "artifact", chatId: this.chatId, artifact });
              }),
            }
          : undefined,
        cwd: config.projectDir ?? workDir,
        env: childEnv,
        pathToClaudeCodeExecutable: claudeBinary,
        resume: config.sessionId ?? undefined,
        // Cutting back forks the session, so the dropped turn stays out of it.
        resumeSessionAt: config.rewindTo ?? undefined,
        forkSession: config.sessionId && (config.rewindTo || config.fork) ? true : undefined,
        stderr: () => {},
      },
    });
    this.pump();
    if (config.projectDir && config.mode === "auto") this.checkAutoMode();
  }

  /**
   * Stop hook: after an answer that changed files, runs the project's check
   * command. A failing check sends Claude back to fix it, a few times at most.
   */
  async afterAnswer(signal) {
    const command = this.config.check;
    if (!command || !this.edited || this.checkRounds >= MAX_CHECK_ROUNDS || this.interrupted) return {};
    this.edited = false;
    this.checkRounds += 1;
    this.flush();
    const id = `check-${randomUUID()}`;
    emit({ type: "tool", chatId: this.chatId, id, name: "Check", detail: command.slice(0, 500) });
    // The check runs outside the sandbox. After changes nobody looked at (a
    // test script, a Makefile, or what a sandboxed command rewrote), the user
    // decides whether it may run.
    if (this.unasked.size || this.unaskedCommands.length) {
      const commands = this.unaskedCommands.length > 0;
      const files = [...this.unasked, ...this.unaskedCommands.map((line) => `$ ${line}`)];
      this.unasked.clear();
      this.unaskedCommands = [];
      const answer = await this.askUser("Check", { command, files, commands }, { signal, toolUseID: id });
      if (answer.behavior !== "allow") return {};
    }
    const controller = new AbortController();
    this.checkStop = controller;
    signal?.addEventListener("abort", () => controller.abort(), { once: true });
    const result = await runCheck(command, this.config.projectDir, controller.signal);
    this.checkStop = null;
    if (this.interrupted || controller.signal.aborted) return {};
    emit({ type: "toolResult", chatId: this.chatId, id, failed: !result.passed, output: result.output || "" });
    if (result.passed) return {};
    return {
      decision: "block",
      reason: `The project's check command \`${command}\` failed after your changes. Fix the cause, then stop. Output (end):\n${result.output}`,
    };
  }

  /** Falls back to manual approvals when the model has no auto mode. */
  checkAutoMode() {
    if (noAutoMode.has(this.config.model)) return this.fallBack();
    this.query
      .supportedModels()
      .then((models) => {
        const info = models.find((entry) => entry.value === this.config.model || entry.resolvedModel === this.config.model);
        if (info && info.supportsAutoMode === false) {
          noAutoMode.add(this.config.model);
          this.fallBack();
        }
      })
      .catch(() => {});
  }

  fallBack() {
    if (this.config.mode !== "auto") return;
    this.setMode("default");
    emit({ type: "mode", chatId: this.chatId, mode: "default", reason: "autoUnavailable" });
  }

  /**
   * The mode the session can honor: Auto and Bypass need the sandbox, which is
   * set when a session starts. Switched to them in a session started without
   * it, commands ask until the next message starts a sandboxed session.
   */
  effectiveMode(mode = this.config.mode) {
    return SANDBOXED_MODES.includes(mode) && !this.sandboxed ? "default" : mode;
  }

  /** Switches the mode, live if the answer is running. */
  setMode(mode) {
    const before = this.effectiveMode();
    this.config.mode = mode;
    const after = this.effectiveMode();
    if (sdkMode(before) !== sdkMode(after)) this.query.setPermissionMode(sdkMode(after)).catch(() => {});
  }

  /** How full the context window is; a local estimate, no extra API call. */
  reportContext() {
    this.query
      .getContextUsage({ detail: "summary" })
      .then((usage) => {
        if (!usage?.rawMaxTokens) return;
        const categories = (usage.categories ?? [])
          .filter((entry) => entry.kind !== "deferred" && entry.tokens > 0)
          .map((entry) => ({ name: String(entry.name), tokens: entry.tokens, kind: entry.kind }));
        emit({
          type: "context",
          chatId: this.chatId,
          used: usage.totalTokens,
          window: usage.rawMaxTokens,
          categories,
        });
      })
      .catch(() => {});
  }

  /**
   * Asks the window whether a change or command may run, and waits for the
   * answer. Edits run without asking once the user allowed all of them for
   * this chat.
   */
  askUser(tool, input, { signal, toolUseID }) {
    const denied = (message) => ({ behavior: "deny", message });
    if (signal?.aborted) return Promise.resolve(denied("The answer was stopped."));
    // A second model's answer that only reads has nobody to approve anything;
    // one working in its own copy of the project asks like the chat's own.
    if (this.config.lane && this.config.mode === "readonly") return Promise.resolve(denied("This answer cannot change anything."));
    // After commands nobody approved, the check is the user's call, also with approve automatically.
    if (autoApproves(tool, input) && !input?.commands) {
      if (EDIT_TOOLS.includes(tool)) this.edited = true;
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    }
    // Anything else that asks (the sandbox wanting network access, say) shows as it is.
    const id = randomUUID();
    this.flush();
    emit({ type: "permission", chatId: this.chatId, id, toolUseId: toolUseID ?? null, ...this.describe(tool, input) });
    return new Promise((done) => {
      const finish = (decision) => {
        if (!this.permissions.delete(id)) return;
        emit({ type: "permissionGone", chatId: this.chatId, id });
        if (decision === "allow" || decision === "always") {
          if (EDIT_TOOLS.includes(tool)) this.edited = true;
          if (decision === "always" && EDIT_TOOLS.includes(tool) && this.config.mode === "default") {
            this.setMode("acceptEdits");
            emit({ type: "mode", chatId: this.chatId, mode: "acceptEdits" });
          }
          done({ behavior: "allow", updatedInput: input });
        } else {
          done(denied("The user declined this. Do not try it another way; ask how they want to go on."));
        }
      };
      // Switching the setting on answers waiting cards that it covers.
      finish.automatic = autoApproves.bind(null, tool, input);
      this.permissions.set(id, finish);
      signal?.addEventListener("abort", () => finish("deny"), { once: true });
    });
  }

  answer(id, decision) {
    this.permissions.get(id)?.(decision);
  }

  /** What the approval card shows: the file and its change, or the command. */
  describe(tool, input) {
    if (tool === "Check") {
      return { tool, command: String(input.command ?? ""), description: (input.files ?? []).slice(0, 12).join(", ") };
    }
    if (!EDIT_TOOLS.includes(tool) && !RUN_TOOLS.includes(tool)) {
      return { tool, command: JSON.stringify(input, null, 2).slice(0, 4000) };
    }
    if (tool === "Bash") {
      return {
        tool,
        command: String(input.command ?? "").slice(0, MAX_CHANGE_CHARS),
        description: String(input.description ?? "").slice(0, 300),
      };
    }
    const path = String(input.file_path ?? "");
    if (tool === "Edit") {
      return {
        tool,
        path: this.relative(path),
        before: String(input.old_string ?? "").slice(0, MAX_CHANGE_CHARS),
        after: String(input.new_string ?? "").slice(0, MAX_CHANGE_CHARS),
        replaceAll: Boolean(input.replace_all),
      };
    }
    return {
      tool,
      path: this.relative(path),
      before: this.currentText(path),
      after: String(input.content ?? "").slice(0, MAX_CHANGE_CHARS),
      created: this.currentText(path) === null,
    };
  }

  /** A file's text before Write replaces it; null if there is none yet. */
  currentText(path) {
    const absolute = isAbsolute(path) ? path : resolve(this.config.projectDir, path);
    try {
      if (statSync(absolute).size > MAX_CHANGE_CHARS * 4) return "";
      return readFileSync(absolute, "utf8").slice(0, MAX_CHANGE_CHARS);
    } catch {
      return null;
    }
  }

  /** Declines whatever still waits for an answer, e.g. when the answer is stopped. */
  dropPermissions() {
    for (const finish of [...this.permissions.values()]) finish("deny");
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
      this.config.projectDir === config.projectDir &&
      (this.config.format ?? null) === (config.format ?? null) &&
      // The sandbox is set when the session starts; the mode menu may have changed since.
      this.sandboxed === needsSandbox(config)
    );
  }

  send(content, { uuid = null, reverted = false } = {}) {
    clearTimeout(this.idleTimer);
    const notes = [];
    if (reverted) notes.push(REVERTED_NOTE);
    if (this.config.projectDir && this.config.mode === "plan") notes.push(PLAN_NOTE);
    if (notes.length) {
      const blocks = typeof content === "string" ? [{ type: "text", text: content }] : content;
      content = [...notes.map((text) => ({ type: "text", text })), ...blocks];
    }
    this.busy = true;
    this.interrupted = false;
    this.edited = false;
    this.unasked.clear();
    this.unaskedCommands = [];
    this.checkRounds = 0;
    this.inbox.push({
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      // The window's message id: file checkpoints are kept per user message.
      ...(uuid ? { uuid } : {}),
      // The user's text goes in as typed: no `@path` file expansion, no slash commands.
      client_composed: true,
    });
  }

  /**
   * A message into the running answer ("Send now"). Claude Code takes it in at
   * the answer's next step; if the answer ends first, it starts an answer of
   * its own, which the window then shows as a new question.
   */
  steer(content, uuid) {
    this.steers.add(uuid);
    this.inbox.push({
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      uuid,
      priority: "next",
      client_composed: true,
    });
  }

  /** A message sent into the answer was taken in. */
  steered(uuid) {
    if (!this.steers.delete(uuid)) return;
    emit({ type: "steered", chatId: this.chatId, id: uuid });
  }

  /** Summarizes the conversation so far; the only command Sienna ever sends. */
  compact() {
    clearTimeout(this.idleTimer);
    this.busy = true;
    this.compacting = true;
    this.interrupted = false;
    // Compaction writes its own messages; rewinding stays tied to the last answer.
    this.keptAssistantUuid = this.lastAssistantUuid;
    this.inbox.push({
      type: "user",
      message: { role: "user", content: "/compact" },
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
    // A helper's own text stays with it; its steps show under the call that started it.
    if (message.parent_tool_use_id) {
      if (message.type === "assistant") this.emitTools(message, message.parent_tool_use_id);
      else if (message.type === "user") this.emitResults(message);
      return;
    }
    // An answer ended with messages still waiting: a new turn now answers the first of them.
    if (this.steerWait && (message.type === "stream_event" || message.type === "assistant")) {
      clearTimeout(this.steerWait);
      this.steerWait = null;
      const [id] = this.steers;
      this.steers.delete(id);
      emit({ type: "steerTurn", chatId: this.chatId, id });
    }
    // Claude Code echoes a message it took into the running answer, and names it on the answer's frames.
    if (message.type === "user" && message.isReplay && message.uuid) this.steered(message.uuid);
    for (const uuid of message.user_message_uuids ?? []) this.steered(uuid);
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
        } else if (message.subtype === "status" && message.status === "compacting") {
          emit({ type: "compacting", chatId: this.chatId });
        } else if (message.subtype === "status" && message.compact_result === "failed") {
          this.compactFailed = true;
        } else if (message.subtype === "compact_boundary") {
          const meta = message.compact_metadata ?? {};
          emit({
            type: "compacted",
            chatId: this.chatId,
            trigger: meta.trigger === "manual" ? "manual" : "auto",
            before: meta.pre_tokens ?? null,
            after: meta.post_tokens ?? null,
          });
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
        this.emitTools(message, null);
        return;
      case "user":
        this.emitResults(message);
        return;
      case "result": {
        this.flush();
        // total_cost_usd is a running total of this query; report the turn's share.
        const total = message.total_cost_usd ?? 0;
        const turnCost = total >= this.costBase ? total - this.costBase : total;
        this.costBase = total;
        this.turnHasText = false;
        this.busy = false;
        if (this.compacting) {
          this.compacting = false;
          this.lastAssistantUuid = this.keptAssistantUuid;
          const failed = this.compactFailed || message.is_error;
          this.compactFailed = false;
          emit({
            type: "compactDone",
            chatId: this.chatId,
            costUsd: turnCost,
            total,
            model: this.config.model,
            error: failed ? "error.compactFailed" : null,
          });
          this.idleTimer = setTimeout(() => this.close(), IDLE_CLOSE_MS);
          this.reportContext();
          return;
        }
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
          // The session's running cost; resuming or forking it later starts from here.
          total,
          structured: this.config.format && !failed ? (message.structured_output ?? null) : null,
          error: failed ? describeError(message) : null,
        });
        // Messages sent in that the answer did not take in run as answers of their own,
        // right after it; if none starts, they were taken in after all.
        if (this.steers.size) {
          this.busy = true;
          this.steerWait = setTimeout(() => {
            this.steerWait = null;
            for (const id of this.steers) emit({ type: "steered", chatId: this.chatId, id });
            this.steers.clear();
            this.busy = false;
            emit({ type: "idle", chatId: this.chatId });
          }, STEER_WAIT_MS);
          return;
        }
        // A second model's answer is done once it is written; its session stays for a branch.
        if (this.config.lane) {
          this.close();
          return;
        }
        this.idleTimer = setTimeout(() => this.close(), IDLE_CLOSE_MS);
        this.reportContext();
        return;
      }
      default:
        return;
    }
  }

  /** The steps in an assistant message, Claude's own or a helper's (`parent`, the call that started it). */
  emitTools(message, parent) {
    for (const block of message.message?.content ?? []) {
      // The answer format's own tool is how a template answer arrives, not a step.
      // An artifact shows as its own card, not as a step.
      if (block.type !== "tool_use" || block.name === "StructuredOutput" || block.name === ARTIFACT_TOOL) continue;
      this.flush();
      const input = block.input ?? {};
      if (RUN_TOOLS.includes(block.name)) {
        this.commandIds.add(block.id);
        const line = String(input.command ?? "");
        if (SANDBOXED_MODES.includes(this.effectiveMode()) && !isReadOnly(line, this.config.projectDir)) {
          this.unaskedCommands.push(line.slice(0, 200));
        }
      }
      emit({
        type: "tool",
        chatId: this.chatId,
        id: block.id,
        ...(parent ? { parent } : {}),
        name: block.name,
        detail: this.relative(
          String(input.command ?? input.query ?? input.url ?? input.pattern ?? input.file_path ?? input.id ?? input.description ?? ""),
        ).slice(0, 4000),
      });
    }
  }

  /** Tool results: a command's output, and whether a tool failed or was declined. */
  emitResults(message) {
    for (const block of Array.isArray(message.message?.content) ? message.message.content : []) {
      if (block.type !== "tool_result") continue;
      const command = this.commandIds.delete(block.tool_use_id);
      if (!command && !block.is_error) continue;
      emit({
        type: "toolResult",
        chatId: this.chatId,
        id: block.tool_use_id,
        failed: Boolean(block.is_error),
        output: command ? maskSecrets(resultText(block.content).slice(-MAX_OUTPUT_CHARS)) : "",
      });
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
      if (this.busy && this.compacting) {
        this.busy = false;
        this.compacting = false;
        emit({ type: "compactDone", chatId: this.chatId, costUsd: 0, error: "error.compactFailed" });
      } else if (this.busy) {
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
    this.dropPermissions();
    this.checkStop?.abort();
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
    this.dropPermissions();
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
  // Fable 5.1 and the 5.5 models can decline a request through safety classifiers.
  if (source?.stop_reason === "refusal") return "error.refused";
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
    // `</` cannot close the block early and pose as the user's own words (as in mention.rs).
    const text = String(file.data).replaceAll("</", "<\\/");
    return { type: "text", text: `<file name="${safeName(file.name)}">\n${text}\n</file>` };
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
  const project = config.projectDir ? [...READ_TOOLS, ...EDIT_TOOLS, ...RUN_TOOLS] : [];
  // A template's answer is data; it needs no helpers.
  return [...project, ...(config.web ? WEB_TOOLS : []), ...(config.format ? [] : AGENT_TOOLS)];
}

/** The tools that run without asking; changes and commands are not among them. */
function allowedFor(config) {
  return [
    ...(config.projectDir ? READ_TOOLS : []),
    ...(config.web ? WEB_TOOLS : []),
    ...(artifactsFor(config) ? [ARTIFACT_TOOL, ARTIFACT_VIEW_TOOL] : []),
    // Starting a helper; what it then does is checked call by call.
    ...(config.format ? [] : AGENT_TOOLS),
  ];
}

/** Artifacts in every chat and for a second model's answer too, but not for a template's data. */
function artifactsFor(config) {
  return !config.format;
}

/** A tool result's text, whether it came as a string or as content blocks. */
function resultText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => (block?.type === "text" ? block.text : "")).join("\n");
}

async function onSend(command) {
  autoApprove = Boolean(command.autoApprove);
  const config = {
    model: command.model,
    effort: command.effort,
    web: Boolean(command.web),
    sessionId: command.sessionId ?? null,
    costSoFar: Number(command.costSoFar) || 0,
    // Already checked and made canonical by the Rust shell.
    projectDir: typeof command.projectDir === "string" && command.projectDir ? command.projectDir : null,
    mode: validMode(command.mode),
    check: typeof command.check === "string" && command.check.trim() ? command.check.trim() : null,
    format: Object.hasOwn(TEMPLATES, command.format ?? "") ? command.format : null,
    lane: Boolean(command.lane),
    rewindTo: null,
    replacesSession: null,
  };
  let session = sessions.get(command.chatId);
  if (command.fork) {
    // A branch (or a second model's answer) continues a copy of another
    // chat's session from one of its answers; the original stays as it is.
    session?.close();
    sessions.delete(command.chatId);
    session = undefined;
    // Without a turn mark the whole session is copied; without a session the chat starts afresh.
    config.fork = true;
    config.rewindTo = command.rewindTo ?? null;
  } else if (command.rewind) {
    // Regenerate or edit: the answer to replace is the last turn of the
    // session. Keep everything up to `rewindTo`; without one, start afresh.
    session?.close();
    sessions.delete(command.chatId);
    session = undefined;
    // A branch may still continue the old session; then it stays.
    config.replacesSession = command.keepReplaced ? null : config.sessionId;
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
  session.setMode(config.mode);
  session.config.check = config.check;
  // Re-inserting keeps the map ordered from least to most recently used.
  sessions.delete(command.chatId);
  sessions.set(command.chatId, session);
  session.send(toContent(command.text, command.attachments), {
    uuid: typeof command.userUuid === "string" ? command.userUuid : null,
    reverted: Boolean(command.reverted),
  });
}

/** Compacts a chat's session, opening it first (from its session id) if needed. */
async function onCompact(command) {
  let session = sessions.get(command.chatId);
  if (session?.busy) return;
  if (!session) {
    if (!command.sessionId) return;
    evictIdleSessions();
    session = new ChatSession(command.chatId, {
      model: command.model,
      effort: command.effort,
      web: Boolean(command.web),
      sessionId: command.sessionId,
      costSoFar: Number(command.costSoFar) || 0,
      projectDir: typeof command.projectDir === "string" && command.projectDir ? command.projectDir : null,
      mode: validMode(command.mode),
      check: null,
      format: null,
      rewindTo: null,
      replacesSession: null,
    });
    sessions.set(command.chatId, session);
  }
  session.compact();
}

/** Undoes the file changes made since a user message, opening the chat's session if needed. */
async function onRewindFiles(command) {
  let session = sessions.get(command.chatId);
  if (session?.busy) throw new Error("busy");
  if (!session) {
    if (!command.sessionId || !command.projectDir) throw new Error("no session");
    evictIdleSessions();
    session = new ChatSession(command.chatId, {
      model: command.model,
      effort: command.effort,
      web: Boolean(command.web),
      sessionId: command.sessionId,
      costSoFar: Number(command.costSoFar) || 0,
      projectDir: command.projectDir,
      mode: validMode(command.mode),
      check: null,
      format: null,
      rewindTo: null,
      replacesSession: null,
    });
    sessions.set(command.chatId, session);
  }
  // Busy while the files change, so no other chat's message closes it halfway.
  session.busy = true;
  clearTimeout(session.idleTimer);
  try {
    const result = await session.query.rewindFiles(command.messageId);
    emit({
      type: "filesReverted",
      chatId: command.chatId,
      messageId: command.messageId,
      files: (result.filesChanged ?? []).map((file) => session.relative(file)),
      error: result.canRewind ? null : "error.revertFailed",
    });
  } finally {
    session.busy = false;
    session.idleTimer = setTimeout(() => session.close(), IDLE_CLOSE_MS);
  }
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
    case "steer": {
      const session = sessions.get(command.chatId);
      const uuid = typeof command.uuid === "string" ? command.uuid : randomUUID();
      // Nothing running any more: the window sends it as an ordinary message.
      if (!session?.busy || session.compacting) {
        emit({ type: "steerReturned", chatId: command.chatId, id: uuid });
        return;
      }
      session.steer(toContent(String(command.text ?? ""), command.attachments), uuid);
      return;
    }
    case "send":
      onSend(command).catch((error) =>
        emit({ type: "done", chatId: command.chatId, costUsd: 0, error: describeError(error) }),
      );
      return;
    case "interrupt":
      sessions.get(command.chatId)?.interrupt();
      return;
    case "rewindFiles":
      onRewindFiles(command).catch(() =>
        emit({ type: "filesReverted", chatId: command.chatId, messageId: command.messageId, files: [], error: "error.revertFailed" }),
      );
      return;
    case "permission":
      sessions.get(command.chatId)?.answer(command.id, command.decision);
      return;
    case "mode":
      sessions.get(command.chatId)?.setMode(validMode(command.mode));
      return;
    case "autoApprove":
      autoApprove = Boolean(command.on);
      for (const session of sessions.values()) {
        for (const finish of [...session.permissions.values()]) if (finish.automatic?.()) finish("allow");
      }
      return;
    case "title":
      onTitle(command).catch(() => {});
      return;
    case "compact":
      onCompact(command).catch((error) =>
        emit({ type: "compactDone", chatId: command.chatId, costUsd: 0, error: describeError(error) }),
      );
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
