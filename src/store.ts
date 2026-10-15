// Loaded chats and the live engine stream. Components subscribe per chat, so
// a streaming answer re-renders only the chat that receives it.

import { listen } from "@tauri-apps/api/event";
import { useCallback, useSyncExternalStore } from "react";
import { api, errorText, type Chat, type ChatSummary, type Message, type Usage } from "./api";

type Listener = () => void;

const chats = new Map<string, Chat>();
const chatListeners = new Map<string, Set<Listener>>();
let summaries: ChatSummary[] = [];
let usage: Usage | null = null;
const globalListeners = new Set<Listener>();

function notifyChat(id: string) {
  chatListeners.get(id)?.forEach((listener) => listener());
}

function notifyGlobal() {
  globalListeners.forEach((listener) => listener());
}

function subscribeGlobal(listener: Listener) {
  globalListeners.add(listener);
  return () => globalListeners.delete(listener);
}

export function useChat(id: string | null): Chat | undefined {
  // A stable subscribe function keeps React from resubscribing on every render.
  const subscribe = useCallback(
    (listener: Listener) => {
      if (!id) return () => {};
      const set = chatListeners.get(id) ?? new Set();
      set.add(listener);
      chatListeners.set(id, set);
      return () => {
        set.delete(listener);
        if (!set.size) chatListeners.delete(id);
      };
    },
    [id],
  );
  return useSyncExternalStore(subscribe, () => (id ? chats.get(id) : undefined));
}

export function useSummaries(): ChatSummary[] {
  return useSyncExternalStore(subscribeGlobal, () => summaries);
}

export function useUsage(): Usage | null {
  return useSyncExternalStore(subscribeGlobal, () => usage);
}

export function getChat(id: string) {
  return chats.get(id);
}

function putChat(chat: Chat) {
  chats.set(chat.id, chat);
  notifyChat(chat.id);
}

function upsertSummary(chat: Chat, keepPlace = false) {
  const entry = { id: chat.id, title: chat.title, updatedAt: chat.updatedAt };
  if (keepPlace && summaries.some((summary) => summary.id === chat.id)) {
    summaries = summaries.map((summary) => (summary.id === chat.id ? entry : summary));
    notifyGlobal();
    return;
  }
  summaries = [
    { id: chat.id, title: chat.title, updatedAt: chat.updatedAt },
    ...summaries.filter((entry) => entry.id !== chat.id),
  ];
  notifyGlobal();
}

export async function refreshSummaries() {
  summaries = await api.chatsList();
  notifyGlobal();
}

export async function refreshUsage() {
  usage = await api.usageGet();
  notifyGlobal();
}

export function setUsage(next: Usage) {
  usage = next;
  notifyGlobal();
}

export async function loadChat(id: string): Promise<Chat> {
  const cached = chats.get(id);
  if (cached) return cached;
  const chat = await api.chatLoad(id);
  // A chat saved while an answer streamed must not show a spinner forever.
  const messages = chat.messages.map((message) =>
    message.streaming ? { ...message, streaming: false, error: message.error ?? "Die Antwort wurde unterbrochen." } : message,
  );
  const clean = { ...chat, messages };
  chats.set(id, clean);
  return clean;
}

export function createChat(defaults: Pick<Chat, "model" | "effort" | "web">): Chat {
  const now = Date.now();
  const chat: Chat = {
    id: crypto.randomUUID(),
    title: "Neuer Chat",
    createdAt: now,
    updatedAt: now,
    sessionId: null,
    costUsd: 0,
    messages: [],
    ...defaults,
  };
  chats.set(chat.id, chat);
  return chat;
}

export function updateChat(id: string, change: (chat: Chat) => Chat) {
  const chat = chats.get(id);
  if (chat) putChat(change(chat));
}

function persist(id: string) {
  const chat = chats.get(id);
  if (chat && chat.messages.length) void api.chatSave(chat).catch(() => {});
}

export async function deleteChat(id: string) {
  await api.chatDelete(id);
  chats.delete(id);
  summaries = summaries.filter((entry) => entry.id !== id);
  notifyGlobal();
}

function titleFrom(text: string, fallback: string) {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  if (!line) return fallback;
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}

function updateLastAssistant(chat: Chat, change: (message: Message) => Message): Chat {
  const index = chat.messages.length - 1;
  const last = chat.messages[index];
  if (!last || last.role !== "assistant") return chat;
  const messages = chat.messages.slice();
  messages[index] = change(last);
  return { ...chat, messages };
}

type Outgoing = { name: string; mediaType: string; data: string };

/** Shows the user's message and an empty answer, then hands both to the engine. */
async function dispatch(chat: Chat, kept: Message[], text: string, attachments: Outgoing[], rewindTo?: string | null) {
  const id = chat.id;
  const user: Message = {
    id: crypto.randomUUID(),
    role: "user",
    text,
    attachments: attachments.map(({ name, mediaType }) => ({ name, mediaType })),
  };
  const reply: Message = { id: crypto.randomUUID(), role: "assistant", text: "", streaming: true };
  const first = kept.length === 0;
  const next: Chat = {
    ...chat,
    title: first && !chat.titleLocked ? titleFrom(text, attachments[0]?.name ?? "Neuer Chat") : chat.title,
    // A new first question deserves a new generated title.
    titleRequested: first ? false : chat.titleRequested,
    updatedAt: Date.now(),
    messages: [...kept, user, reply],
  };
  putChat(next);
  upsertSummary(next);
  persist(id);
  const rewind = rewindTo !== undefined;
  // What the session behind this chat has cost so far: the answers it still
  // contains. A dropped answer was paid for but is no longer in the session.
  const sessionCost = kept.reduce((sum, message) => sum + (message.costUsd ?? 0), 0);
  try {
    const engine = await api.chatSend({
      chatId: id,
      sessionId: next.sessionId,
      model: next.model,
      effort: next.effort,
      web: next.web,
      text,
      attachments: attachments.map(({ mediaType, data }) => ({ mediaType, data })),
      costSoFar: sessionCost,
      rewind,
      rewindTo: rewindTo ?? null,
    });
    updateChat(id, (current) =>
      updateLastAssistant(current, (message) => (message.id === reply.id ? { ...message, engine } : message)),
    );
  } catch (error) {
    updateChat(id, (current) =>
      updateLastAssistant(current, (message) => ({ ...message, streaming: false, error: errorText(error) })),
    );
    persist(id);
  }
}

export async function sendMessage(id: string, text: string, attachments: Outgoing[]) {
  const chat = chats.get(id);
  if (chat) await dispatch(chat, chat.messages, text, attachments);
}

/**
 * Where a rewind of the last exchange cuts back to: the end of the answer
 * before it, or `null` when the last exchange is the first. `undefined` means
 * it cannot be rewound (still streaming, attachments that are not kept, or an
 * older chat without turn marks).
 */
export function rewindPoint(chat: Chat): string | null | undefined {
  const count = chat.messages.length;
  const last = chat.messages[count - 1];
  const question = chat.messages[count - 2];
  if (!last || last.role !== "assistant" || last.streaming) return undefined;
  if (!question || question.role !== "user" || question.attachments?.length) return undefined;
  if (count === 2) return null;
  return chat.messages[count - 3]?.turnEnd ?? undefined;
}

/** Answers the last question again, or the same question in new words. */
export async function redoLast(id: string, text?: string) {
  const chat = chats.get(id);
  if (!chat) return;
  const point = rewindPoint(chat);
  if (point === undefined) return;
  const question = chat.messages[chat.messages.length - 2];
  const newText = (text ?? question.text).trim();
  if (!newText) return;
  await dispatch(chat, chat.messages.slice(0, -2), newText, [], point);
}

export async function renameChat(id: string, title: string) {
  const clean = title.trim().slice(0, 120);
  if (!clean) return;
  const chat = await loadChat(id).catch(() => undefined);
  if (!chat) return;
  const next = { ...chat, title: clean, titleLocked: true };
  putChat(next);
  upsertSummary(next, true);
  persist(id);
}

/** After the first answer, Haiku suggests a better title than the first line. */
function requestTitle(chat: Chat) {
  if (chat.titleLocked || chat.titleRequested || chat.messages.length !== 2) return;
  const [question, answer] = chat.messages;
  if (!answer || answer.error || !answer.text) return;
  putChat({ ...chat, titleRequested: true });
  void api.chatTitle(chat.id, `${question.text}\n\n${answer.text.slice(0, 1500)}`).catch(() => {});
}

export function stopMessage(id: string) {
  void api.chatStop(id);
}

type EngineEvent =
  | { type: "session"; chatId: string; sessionId: string }
  | { type: "delta"; chatId: string; text: string; thinking: string }
  | { type: "tool"; chatId: string; name: string; detail: string }
  | {
      type: "done";
      chatId: string;
      sessionId?: string;
      costUsd: number;
      turnEnd?: string | null;
      error: string | null;
    }
  | { type: "title"; chatId: string; title: string }
  | { type: "fatal"; message: string; generation: number }
  | { type: "exit"; generation: number }
  | { type: "ready" };

/** Fails the answers a stopped engine was streaming, and only those. */
function failStreaming(generation: number, reason: string) {
  for (const chat of chats.values()) {
    const last = chat.messages[chat.messages.length - 1];
    if (last?.streaming && last.engine === generation) {
      putChat(updateLastAssistant(chat, (message) => ({ ...message, streaming: false, error: reason })));
      persist(chat.id);
    }
  }
}

function onEngineEvent(event: EngineEvent) {
  switch (event.type) {
    case "session":
      updateChat(event.chatId, (chat) => ({ ...chat, sessionId: event.sessionId }));
      return;
    case "delta":
      updateChat(event.chatId, (chat) =>
        updateLastAssistant(chat, (message) => ({
          ...message,
          text: message.text + event.text,
          thinking: event.thinking ? (message.thinking ?? "") + event.thinking : message.thinking,
        })),
      );
      return;
    case "tool":
      updateChat(event.chatId, (chat) =>
        updateLastAssistant(chat, (message) => ({
          ...message,
          tools: [...(message.tools ?? []), { name: event.name, detail: event.detail }],
        })),
      );
      return;
    case "done":
      updateChat(event.chatId, (chat) => ({
        ...updateLastAssistant(chat, (message) => ({
          ...message,
          streaming: false,
          costUsd: (message.costUsd ?? 0) + event.costUsd,
          turnEnd: event.turnEnd ?? null,
          error: event.error,
        })),
        sessionId: event.sessionId ?? chat.sessionId,
        costUsd: chat.costUsd + event.costUsd,
        updatedAt: Date.now(),
      }));
      persist(event.chatId);
      {
        const chat = chats.get(event.chatId);
        if (chat) requestTitle(chat);
      }
      return;
    case "title": {
      const chat = chats.get(event.chatId);
      if (!chat || chat.titleLocked || !event.title) return;
      const next = { ...chat, title: event.title };
      putChat(next);
      upsertSummary(next, true);
      persist(chat.id);
      return;
    }
    case "fatal":
      failStreaming(event.generation, event.message);
      return;
    case "exit":
      failStreaming(event.generation, "Die Chat-Engine wurde beendet. Bitte noch einmal senden.");
      return;
    default:
      return;
  }
}

let started = false;

export function startEngineListener() {
  if (started) return;
  started = true;
  void listen<EngineEvent>("engine", (event) => onEngineEvent(event.payload));
  void listen<Usage>("usage", (event) => setUsage(event.payload));
}
