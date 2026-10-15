import { invoke } from "@tauri-apps/api/core";

export type ModelId = "claude-sonnet-5-5" | "claude-opus-5-5" | "claude-haiku-5-5";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export const MODELS: { id: ModelId; name: string; hint: string }[] = [
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5", hint: "Schnell und stark für fast alles" },
  { id: "claude-opus-5-5", name: "Opus 5.5", hint: "Am gründlichsten, kostet doppelt so viel" },
  { id: "claude-haiku-5-5", name: "Haiku 5.5", hint: "Blitzschnell und sehr günstig" },
];

export const EFFORTS: { id: Effort; name: string }[] = [
  { id: "low", name: "Niedrig" },
  { id: "medium", name: "Mittel" },
  { id: "high", name: "Hoch" },
];

export interface ToolUse {
  name: string;
  detail: string;
}

export interface AttachmentMeta {
  name: string;
  mediaType: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
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
}

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
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
    attachments: { mediaType: string; data: string }[];
    costSoFar: number;
    rewind?: boolean;
    rewindTo?: string | null;
  }) => invoke<number>("chat_send", { request }),
  chatTitle: (chatId: string, text: string) => invoke<void>("chat_title", { chatId, text }),
};

export function errorText(error: unknown): string {
  return typeof error === "string" ? error : "Etwas ist schiefgelaufen.";
}

const usd = new Intl.NumberFormat("de-DE", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const usdFine = new Intl.NumberFormat("de-DE", { style: "currency", currency: "USD", maximumFractionDigits: 3 });

export function formatUsd(value: number): string {
  return value > 0 && value < 0.1 ? usdFine.format(value) : usd.format(value);
}
