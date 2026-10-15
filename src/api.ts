import { invoke } from "@tauri-apps/api/core";
import { locale, type TextKey } from "./i18n";

export type ModelId = "claude-haiku-5-5" | "claude-sonnet-5-5" | "claude-opus-5-5" | "claude-fable-5-1";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

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
  tool: "Edit" | "Write" | "Bash";
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
  /** File changes in the project run without asking first. */
  autoEdits?: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
  pinned?: boolean;
  projectId?: string;
  projectDir?: string;
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
    autoEdits?: boolean;
  }) => invoke<number>("chat_send", { request }),
  chatPermission: (chatId: string, id: string, decision: PermissionDecision) =>
    invoke<void>("chat_permission", { chatId, id, decision }),
  chatAutoEdits: (chatId: string, on: boolean) => invoke<void>("chat_auto_edits", { chatId, on }),
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
