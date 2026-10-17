import { invoke } from "@tauri-apps/api/core";
import { autoApproveOn } from "./autoApprove";
import { locale, type TextKey } from "./i18n";

export type ModelId = "claude-haiku-5-5" | "claude-sonnet-5-5" | "claude-opus-5-5" | "claude-fable-5-1";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
/** How far Claude may go without asking in a project chat, as in Claude Code. */
export type PermissionMode = "auto" | "default" | "acceptEdits" | "plan" | "bypassPermissions";

/** The modes in the menu, numbered 1–4; bypassing permissions is set apart. */
export const MODES: { id: PermissionMode; name: TextKey; hint: TextKey }[] = [
  { id: "auto", name: "mode.auto", hint: "mode.autoHint" },
  { id: "default", name: "mode.default", hint: "mode.defaultHint" },
  { id: "acceptEdits", name: "mode.acceptEdits", hint: "mode.acceptEditsHint" },
  { id: "plan", name: "mode.plan", hint: "mode.planHint" },
];
export const DEFAULT_MODE: PermissionMode = "auto";

export type TemplateId = "changelog" | "review" | "tasks";

/** Recurring tasks with a fixed answer format; the first two need a project. */
export const TEMPLATES: {
  id: TemplateId;
  name: TextKey;
  /** The slash command, without the slash. */
  command: TextKey;
  prompt: TextKey;
  project: boolean;
  /** Works on the conversation so far, so it needs an answer first. */
  conversation: boolean;
}[] = [
  {
    id: "tasks",
    name: "template.tasks",
    command: "slash.tasks",
    prompt: "template.tasksPrompt",
    project: false,
    conversation: true,
  },
  {
    id: "review",
    name: "template.review",
    command: "slash.review",
    prompt: "template.reviewPrompt",
    project: true,
    conversation: false,
  },
  {
    id: "changelog",
    name: "template.changelog",
    command: "slash.changelog",
    prompt: "template.changelogPrompt",
    project: true,
    conversation: false,
  },
];

/** Ordered by strength (and price). */
export const MODELS: { id: ModelId; name: string }[] = [
  { id: "claude-haiku-5-5", name: "Haiku 5.5" },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5" },
  { id: "claude-opus-5-5", name: "Opus 5.5" },
  { id: "claude-fable-5-1", name: "Fable 5.1" },
];

/** Every current model accepts all five effort levels. */
export const EFFORTS: { id: Effort; name: TextKey }[] = [
  { id: "low", name: "effort.low" },
  { id: "medium", name: "effort.medium" },
  { id: "high", name: "effort.high" },
  { id: "xhigh", name: "effort.xhigh" },
  { id: "max", name: "effort.max" },
];

/** A file change as Claude made it: the replaced text and the new text. */
export interface FileChange {
  before: string;
  after: string;
  /** Write made a new file. */
  created?: boolean;
}

export interface ToolUse {
  /** The SDK's tool use id; older chats have none. */
  id?: string;
  name: string;
  detail: string;
  /** The user declined the change or command. */
  denied?: boolean;
  failed?: boolean;
  /** A command's output, the end of it if long. */
  output?: string;
  change?: FileChange;
}

/** A change or command waiting for the user's approval. */
export interface PermissionRequest {
  id: string;
  toolUseId: string | null;
  /** Edit, Write or Bash; anything else shows its input as it is. */
  tool: string;
  path?: string;
  before?: string | null;
  after?: string;
  created?: boolean;
  replaceAll?: boolean;
  command?: string;
  description?: string;
}

export type PermissionDecision = "allow" | "always" | "deny";

export interface AttachmentMeta {
  name: string;
  mediaType: string;
}

export interface Message {
  id: string;
  /** "note" is a line in the thread, such as a context compaction; never sent to Claude. */
  role: "user" | "assistant" | "note";
  text: string;
  thinking?: string;
  tools?: ToolUse[];
  attachments?: AttachmentMeta[];
  costUsd?: number;
  error?: string | null;
  streaming?: boolean;
  /** The engine process that streams this answer (see engine.rs). */
  engine?: number;
  /** SDK message id at the end of this answer's turn; a rewind cuts back to it. */
  turnEnd?: string | null;
  /** The model of an answer shown next to another model's. */
  model?: ModelId;
  /** A second model's answer to the same question; not part of the chat's session. */
  lane?: boolean;
  /** That answer's own session, turn end and running cost, to continue it in a branch. */
  laneSession?: string | null;
  laneTurnEnd?: string | null;
  laneTotal?: number | null;
  /** The session's running cost after this answer; a fork or redo from here starts there. */
  sessionTotal?: number | null;
  /** Written in this chat's own project session, so its file changes can be undone. */
  checkpoint?: boolean;
  /** A template's answer: its format and the data Claude returned. */
  format?: TemplateId;
  structured?: unknown;
  /** The file changes of this answer were undone. */
  reverted?: boolean;
  /** Written in plan mode: the answer ends with a plan to carry out. */
  plan?: boolean;
  /** Changes and commands this answer waits on; never saved. */
  permissions?: PermissionRequest[];
  /** For a note about a compaction: how it was triggered and the tokens before and after. */
  compaction?: { trigger: "manual" | "auto"; before: number | null; after: number | null };
}

export interface ContextCategory {
  name: string;
  tokens: number;
  kind: "used" | "free" | "buffer";
}

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: ModelId;
  effort: Effort;
  web: boolean;
  sessionId: string | null;
  costUsd: number;
  messages: Message[];
  /** Renamed by hand: the generated title must not replace it. */
  titleLocked?: boolean;
  /** A generated title was already asked for. */
  titleRequested?: boolean;
  /** Pinned chats stay on top of the sidebar. */
  pinned?: boolean;
  /** A folder Claude may read and search in this chat. */
  projectDir?: string | null;
  /** The project the chat belongs to in the sidebar. */
  projectId?: string | null;
  /** Context window use after the last answer, in tokens. */
  context?: { used: number; window: number; categories?: ContextCategory[] } | null;
  /** The conversation is being summarized right now. */
  compacting?: boolean;
  /** How far Claude may go without asking (project chats). */
  mode?: PermissionMode;
  /** The chat this one branched off. */
  branchOf?: string | null;
  /** Until the branch's first message: the session and answer it continues from. */
  forkFrom?: { sessionId: string; at: string; total?: number | null } | null;
  /** The running cost of the chat's session, as Claude Code last reported it. */
  sessionTotal?: number | null;
  /** Each question also goes to this model; its answer shows next to the chat's own. */
  compareModel?: ModelId | null;
  /** File changes were undone since the last message; Claude hears about it with the next one. */
  reverted?: boolean;
  /** Older chats: file changes ran without asking. */
  autoEdits?: boolean;
}

/** A file or folder of a project, relative to its folder, for `@` mentions. */
export interface ProjectEntry {
  path: string;
  dir: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  /** Run after Claude changed files, such as `npm test`. */
  check?: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
  pinned?: boolean;
  projectId?: string;
  projectDir?: string;
  branchOf?: string;
}

export interface Usage {
  month: string;
  usd: number;
  budget: number;
  byModel: Record<string, number>;
}

export interface OutgoingAttachment extends AttachmentMeta {
  data: string;
  previewUrl?: string;
}

export const api = {
  appLanguage: () => invoke<string>("app_language"),
  keyStatus: () => invoke<boolean>("key_status"),
  keySave: (key: string) => invoke<void>("key_save", { key }),
  keyDelete: () => invoke<void>("key_delete"),
  chatsList: () => invoke<ChatSummary[]>("chats_list"),
  chatLoad: (id: string) => invoke<Chat>("chat_load", { id }),
  chatSave: (chat: Chat) => invoke<void>("chat_save", { chat }),
  chatDelete: (id: string) => invoke<void>("chat_delete", { id }),
  usageGet: () => invoke<Usage>("usage_get"),
  budgetSet: (usd: number) => invoke<Usage>("budget_set", { usd }),
  chatStop: (chatId: string) => invoke<void>("chat_stop", { chatId }),
  chatSend: (request: {
    chatId: string;
    sessionId: string | null;
    model: ModelId;
    effort: Effort;
    web: boolean;
    text: string;
    attachments: { name: string; mediaType: string; data: string }[];
    costSoFar: number;
    rewind?: boolean;
    rewindTo?: string | null;
    projectDir?: string | null;
    /** `readonly`: a second model's answer, which never touches the project folder. */
    mode: PermissionMode | "readonly";
    fork?: boolean;
    lane?: boolean;
    check?: string | null;
    format?: TemplateId | null;
    userUuid?: string;
    reverted?: boolean;
  }) => invoke<number>("chat_send", { request: { ...request, autoApprove: autoApproveOn() } }),
  chatRevertFiles: (request: {
    chatId: string;
    sessionId: string;
    messageId: string;
    model: ModelId;
    effort: Effort;
    web: boolean;
    projectDir: string;
    mode: PermissionMode;
    costSoFar: number;
  }) => invoke<void>("chat_revert_files", { request }),
  projectSetCheck: (id: string, check: string) => invoke<void>("project_set_check", { id, check }),
  projectGuessCheck: (path: string) => invoke<string>("project_guess_check", { path }),
  projectFiles: (path: string) => invoke<ProjectEntry[]>("project_files", { path }),
  chatPermission: (chatId: string, id: string, decision: PermissionDecision) =>
    invoke<void>("chat_permission", { chatId, id, decision }),
  projectOpenFile: (projectDir: string, path: string) => invoke<void>("project_open_file", { projectDir, path }),
  chatMode: (chatId: string, mode: PermissionMode) => invoke<void>("chat_mode", { chatId, mode }),
  voiceStart: (language: "de" | "en") => invoke<number>("voice_start", { language }),
  voiceStop: () => invoke<void>("voice_stop"),
  voiceCancel: () => invoke<void>("voice_cancel"),
  projectCheck: (path: string) => invoke<string>("project_check", { path }),
  projectsList: () => invoke<Project[]>("projects_list"),
  projectAdd: (id: string, path: string) => invoke<Project>("project_add", { id, path }),
  projectRename: (id: string, name: string) => invoke<void>("project_rename", { id, name }),
  projectRemove: (id: string) => invoke<void>("project_remove", { id }),
  chatTitle: (chatId: string, text: string) => invoke<void>("chat_title", { chatId, text }),
  chatCompact: (request: {
    chatId: string;
    sessionId: string | null;
    model: ModelId;
    effort: Effort;
    web: boolean;
    costSoFar: number;
    projectDir: string | null;
    mode: PermissionMode;
  }) => invoke<void>("chat_compact", { request }),
};

let formatters: { locale: string; coarse: Intl.NumberFormat; fine: Intl.NumberFormat } | null = null;

export function formatUsd(value: number): string {
  if (formatters?.locale !== locale()) {
    const options = { style: "currency", currency: "USD" } as const;
    formatters = {
      locale: locale(),
      coarse: new Intl.NumberFormat(locale(), { ...options, maximumFractionDigits: 2 }),
      fine: new Intl.NumberFormat(locale(), { ...options, maximumFractionDigits: 3 }),
    };
  }
  return value > 0 && value < 0.1 ? formatters.fine.format(value) : formatters.coarse.format(value);
}
