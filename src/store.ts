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

function upsertSummary(chat: Chat) {
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

export async function sendMessage(
  id: string,
  text: string,
  attachments: { name: string; mediaType: string; data: string }[],
) {
  const chat = chats.get(id);
  if (!chat) return;
  const user: Message = {
    id: crypto.randomUUID(),
    role: "user",
    text,
    attachments: attachments.map(({ name, mediaType }) => ({ name, mediaType })),
  };
  const reply: Message = { id: crypto.randomUUID(), role: "assistant", text: "", streaming: true };
  const isFirst = chat.messages.length === 0;
  const next: Chat = {
    ...chat,
    title: isFirst ? titleFrom(text, attachments[0]?.name ?? "Neuer Chat") : chat.title,
    updatedAt: Date.now(),
    messages: [...chat.messages, user, reply],
  };
  putChat(next);
  upsertSummary(next);
  persist(id);
  try {
    const engine = await api.chatSend({
      chatId: id,
      sessionId: next.sessionId,
      model: next.model,
      effort: next.effort,
      web: next.web,
      text,
      attachments: attachments.map(({ mediaType, data }) => ({ mediaType, data })),
      costSoFar: next.costUsd,
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

export function stopMessage(id: string) {
  void api.chatStop(id);
}

type EngineEvent =
  | { type: "session"; chatId: string; sessionId: string }
  | { type: "delta"; chatId: string; text: string; thinking: string }
  | { type: "tool"; chatId: string; name: string; detail: string }
  | { type: "done"; chatId: string; sessionId?: string; costUsd: number; error: string | null }
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
          error: event.error,
        })),
        sessionId: event.sessionId ?? chat.sessionId,
        costUsd: chat.costUsd + event.costUsd,
        updatedAt: Date.now(),
      }));
      persist(event.chatId);
      return;
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
