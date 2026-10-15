// Loaded chats and the live engine stream. Components subscribe per chat, so
// a streaming answer re-renders only the chat that receives it.

import { listen } from "@tauri-apps/api/event";
import { useCallback, useSyncExternalStore } from "react";
import {
  api,
  type Chat,
  type ChatSummary,
  type ContextCategory,
  type FileChange,
  type Message,
  type PermissionDecision,
  type PermissionRequest,
  type Project,
  type ToolUse,
  type Usage,
} from "./api";
import { t } from "./i18n";

type Listener = () => void;

const chats = new Map<string, Chat>();
const chatListeners = new Map<string, Set<Listener>>();
let summaries: ChatSummary[] = [];
let usage: Usage | null = null;
let projects: Project[] = [];
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

export function useProjects(): Project[] {
  return useSyncExternalStore(subscribeGlobal, () => projects);
}

export function getProject(id: string | null | undefined): Project | undefined {
  return id ? projects.find((project) => project.id === id) : undefined;
}

/**
 * The project a chat belongs to: by its project id, or, for a chat that only
 * has a folder (picked before projects existed), by that folder's path.
 */
export function projectFor(
  chat: { projectId?: string | null; projectDir?: string | null },
  list: Project[],
): Project | undefined {
  return (
    list.find((project) => project.id === chat.projectId) ??
    (chat.projectDir ? list.find((project) => project.path === chat.projectDir) : undefined)
  );
}

export async function refreshProjects() {
  projects = await api.projectsList();
  notifyGlobal();
}

/** Adds a folder as a project; returns it, or throws an error code. */
export async function addProject(path: string): Promise<Project> {
  const project = await api.projectAdd(crypto.randomUUID(), path);
  if (!projects.some((entry) => entry.id === project.id)) projects = [...projects, project];
  notifyGlobal();
  return project;
}

export async function renameProject(id: string, name: string) {
  const clean = name.trim();
  if (!clean) return;
  await api.projectRename(id, clean);
  projects = projects.map((project) => (project.id === id ? { ...project, name: clean } : project));
  notifyGlobal();
}

/** Takes a project off the list; its chats stay and move to the other chats. */
export async function removeProject(id: string) {
  await api.projectRemove(id);
  projects = projects.filter((project) => project.id !== id);
  notifyGlobal();
}

export function getChat(id: string) {
  return chats.get(id);
}

function putChat(chat: Chat) {
  chats.set(chat.id, chat);
  notifyChat(chat.id);
}

function upsertSummary(chat: Chat, keepPlace = false) {
  const entry = {
    id: chat.id,
    title: chat.title,
    updatedAt: chat.updatedAt,
    pinned: chat.pinned,
    projectId: chat.projectId ?? undefined,
    projectDir: chat.projectDir ?? undefined,
  };
  if (keepPlace && summaries.some((summary) => summary.id === chat.id)) {
    summaries = summaries.map((summary) => (summary.id === chat.id ? entry : summary));
    notifyGlobal();
    return;
  }
  summaries = [
    entry,
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
    message.streaming
      ? { ...message, streaming: false, permissions: undefined, error: message.error ?? "error.interrupted" }
      : message,
  );
  const clean = { ...chat, messages, compacting: false };
  chats.set(id, clean);
  return clean;
}

export function createChat(defaults: Pick<Chat, "model" | "effort" | "web">, project?: Project): Chat {
  const now = Date.now();
  const chat: Chat = {
    id: crypto.randomUUID(),
    title: t("app.newChat"),
    createdAt: now,
    updatedAt: now,
    sessionId: null,
    costUsd: 0,
    messages: [],
    ...defaults,
    projectId: project?.id ?? null,
    projectDir: project?.path ?? null,
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
  if (!chat || !chat.messages.length) return;
  // Open approvals belong to the running engine, not to the saved chat.
  const messages = chat.messages.map((message) => (message.permissions ? { ...message, permissions: undefined } : message));
  void api.chatSave({ ...chat, messages }).catch(() => {});
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

/** Messages keep the error code, so the text follows the interface language. */
function errorCode(error: unknown): string {
  return typeof error === "string" && error.startsWith("error.") ? error : "error.generic";
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
    title: first && !chat.titleLocked ? titleFrom(text, attachments[0]?.name ?? t("app.newChat")) : chat.title,
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
      attachments: attachments.map(({ name, mediaType, data }) => ({ name, mediaType, data })),
      costSoFar: sessionCost,
      rewind,
      rewindTo: rewindTo ?? null,
      projectDir: next.projectDir ?? null,
      autoEdits: Boolean(next.autoEdits),
    });
    updateChat(id, (current) =>
      updateLastAssistant(current, (message) => (message.id === reply.id ? { ...message, engine } : message)),
    );
  } catch (error) {
    updateChat(id, (current) =>
      updateLastAssistant(current, (message) => ({ ...message, streaming: false, error: errorCode(error) })),
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

export async function togglePin(id: string) {
  const chat = await loadChat(id).catch(() => undefined);
  if (!chat) return;
  const next = { ...chat, pinned: !chat.pinned };
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

// A stored change keeps at most this much of each side, so chats stay small.
const MAX_STORED_CHANGE = 20_000;

function storedChange(request: PermissionRequest): FileChange {
  return {
    before: (request.before ?? "").slice(0, MAX_STORED_CHANGE),
    after: (request.after ?? "").slice(0, MAX_STORED_CHANGE),
    created: request.created || undefined,
  };
}

/** Changes the tool entry with this id in the chat's last answer. */
function updateTool(chat: Chat, toolId: string | null | undefined, change: (tool: ToolUse) => ToolUse): Chat {
  if (!toolId) return chat;
  return updateLastAssistant(chat, (message) =>
    message.tools?.some((tool) => tool.id === toolId)
      ? { ...message, tools: message.tools.map((tool) => (tool.id === toolId ? change(tool) : tool)) }
      : message,
  );
}

/** The user's answer to a change or command Claude wants to run. */
export function answerPermission(chatId: string, request: PermissionRequest, decision: PermissionDecision) {
  updateChat(chatId, (chat) => {
    let next = updateLastAssistant(chat, (message) => ({
      ...message,
      permissions: message.permissions?.filter((entry) => entry.id !== request.id),
    }));
    next = updateTool(next, request.toolUseId, (tool) =>
      decision === "deny"
        ? { ...tool, denied: true }
        : request.tool === "Bash"
          ? tool
          : { ...tool, change: storedChange(request) },
    );
    if (decision === "always" && request.tool !== "Bash") next = { ...next, autoEdits: true };
    return next;
  });
  void api.chatPermission(chatId, request.id, decision).catch(() => {});
}

/** Lets file changes in a project chat run without asking, or asks again. */
export function setAutoEdits(chatId: string, on: boolean) {
  updateChat(chatId, (chat) => ({ ...chat, autoEdits: on }));
  persist(chatId);
  void api.chatAutoEdits(chatId, on).catch(() => {});
}

type EngineEvent =
  | { type: "session"; chatId: string; sessionId: string }
  | { type: "delta"; chatId: string; text: string; thinking: string }
  | { type: "tool"; chatId: string; id?: string; name: string; detail: string }
  | { type: "toolResult"; chatId: string; id: string; failed: boolean; output: string }
  | ({ type: "permission"; chatId: string } & PermissionRequest)
  | { type: "permissionGone"; chatId: string; id: string }
  | ({ type: "change"; chatId: string } & PermissionRequest)
  | {
      type: "done";
      chatId: string;
      sessionId?: string;
      costUsd: number;
      turnEnd?: string | null;
      error: string | null;
    }
  | { type: "title"; chatId: string; title: string }
  | { type: "context"; chatId: string; used: number; window: number; categories?: ContextCategory[] }
  | { type: "compacting"; chatId: string }
  | { type: "compacted"; chatId: string; trigger: "manual" | "auto"; before: number | null; after: number | null }
  | { type: "compactDone"; chatId: string; costUsd: number; error: string | null }
  | { type: "fatal"; message: string; generation: number }
  | { type: "exit"; generation: number }
  | { type: "ready" };

/**
 * Adds a note to the thread: before an answer that is still streaming (an
 * automatic compaction runs before it), otherwise at the end. Answers before
 * a compaction can no longer be rewound to, so their marks are dropped.
 */
function withNote(chat: Chat, note: Message): Chat {
  const messages = chat.messages.map((message) => (message.turnEnd ? { ...message, turnEnd: null } : message));
  const last = messages[messages.length - 1];
  if (last?.streaming) messages.splice(messages.length - 1, 0, note);
  else messages.push(note);
  return { ...chat, messages };
}

/** Summarizes the chat's conversation to free context. */
export async function compactChat(id: string) {
  const chat = chats.get(id);
  if (!chat || !chat.sessionId || chat.compacting) return;
  if (chat.messages[chat.messages.length - 1]?.streaming) return;
  putChat({ ...chat, compacting: true });
  try {
    await api.chatCompact({
      chatId: id,
      sessionId: chat.sessionId,
      model: chat.model,
      effort: chat.effort,
      web: chat.web,
      costSoFar: chat.messages.reduce((sum, message) => sum + (message.costUsd ?? 0), 0),
      projectDir: chat.projectDir ?? null,
    });
  } catch (error) {
    updateChat(id, (current) =>
      withNote({ ...current, compacting: false }, { id: crypto.randomUUID(), role: "note", text: "", error: errorCode(error) }),
    );
    persist(id);
  }
}

/** Fails the answers a stopped engine was streaming, and only those. */
function failStreaming(generation: number, reason: string) {
  for (const chat of chats.values()) {
    const last = chat.messages[chat.messages.length - 1];
    if (last?.streaming && last.engine === generation) {
      putChat(updateLastAssistant(chat, (message) => ({ ...message, streaming: false, permissions: undefined, error: reason })));
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
          tools: [...(message.tools ?? []), { id: event.id, name: event.name, detail: event.detail }],
        })),
      );
      return;
    case "toolResult":
      updateChat(event.chatId, (chat) =>
        updateTool(chat, event.id, (tool) => ({
          ...tool,
          failed: event.failed && !tool.denied,
          output: event.output || tool.output,
        })),
      );
      return;
    case "permission": {
      const { type: _type, chatId: _chatId, ...request } = event;
      updateChat(event.chatId, (chat) =>
        updateLastAssistant(chat, (message) =>
          message.streaming
            ? { ...message, permissions: [...(message.permissions ?? []).filter((entry) => entry.id !== request.id), request] }
            : message,
        ),
      );
      return;
    }
    case "permissionGone":
      updateChat(event.chatId, (chat) =>
        updateLastAssistant(chat, (message) =>
          message.permissions?.some((entry) => entry.id === event.id)
            ? { ...message, permissions: message.permissions.filter((entry) => entry.id !== event.id) }
            : message,
        ),
      );
      return;
    case "change": {
      // A change that ran without asking (edits allowed for the whole chat).
      const { type: _type, chatId: _chatId, ...request } = event;
      updateChat(event.chatId, (chat) => updateTool(chat, request.toolUseId, (tool) => ({ ...tool, change: storedChange(request) })));
      return;
    }
    case "done":
      updateChat(event.chatId, (chat) => ({
        ...updateLastAssistant(chat, (message) => ({
          ...message,
          streaming: false,
          permissions: undefined,
          costUsd: (message.costUsd ?? 0) + event.costUsd,
          turnEnd: event.turnEnd ?? null,
          error: event.error,
        })),
        sessionId: event.sessionId ?? chat.sessionId,
        costUsd: chat.costUsd + event.costUsd,
        compacting: false,
        updatedAt: Date.now(),
      }));
      persist(event.chatId);
      {
        const chat = chats.get(event.chatId);
        if (chat) requestTitle(chat);
      }
      return;
    case "context":
      updateChat(event.chatId, (chat) => ({
        ...chat,
        context: { used: event.used, window: event.window, categories: event.categories },
      }));
      persist(event.chatId);
      return;
    case "compacting":
      updateChat(event.chatId, (chat) => ({ ...chat, compacting: true }));
      return;
    case "compacted":
      // An automatic compaction has no compactDone; the boundary marks its end.
      updateChat(event.chatId, (chat) => withNote({ ...chat, compacting: false }, {
        id: crypto.randomUUID(),
        role: "note",
        text: "",
        compaction: { trigger: event.trigger, before: event.before, after: event.after },
      }));
      persist(event.chatId);
      return;
    case "compactDone":
      updateChat(event.chatId, (chat) => {
        const next = { ...chat, compacting: false, costUsd: chat.costUsd + event.costUsd };
        return event.error ? withNote(next, { id: crypto.randomUUID(), role: "note", text: "", error: event.error }) : next;
      });
      persist(event.chatId);
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
      failStreaming(event.generation, "error.engineStopped");
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
