// Loaded chats and the live engine stream. Components subscribe per chat, so
// a streaming answer re-renders only the chat that receives it.

import { listen } from "@tauri-apps/api/event";
import { useCallback, useSyncExternalStore } from "react";
import {
  type Artifact,
  type Steer,
  allTools,
  api,
  DEFAULT_MODE,
  TEMPLATES,
  type Chat,
  type ChatSummary,
  type ContextCategory,
  type FileChange,
  type Message,
  type ModelId,
  type PermissionDecision,
  type PermissionMode,
  type PermissionRequest,
  type Project,
  type TemplateId,
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
  refreshStatus(chat);
}

/**
 * What the sidebar shows next to a chat, as in Claude Code: it is working,
 * it waits for an approval, or it finished while the user was elsewhere.
 */
export type ChatStatus = "running" | "waiting" | "done";
let statuses = new Map<string, ChatStatus>();
const statusListeners = new Set<Listener>();
/** Finished while not open; cleared when the chat is opened. */
const unread = new Set<string>();
let openChatId: string | null = null;

function refreshStatus(chat: Chat) {
  const before = statuses.get(chat.id);
  const live = chat.messages.some((message) => message.streaming) || Boolean(chat.compacting);
  const waiting = chat.messages.some((message) => message.permissions?.length);
  if (!live && (before === "running" || before === "waiting") && chat.id !== openChatId) unread.add(chat.id);
  const now: ChatStatus | undefined = waiting ? "waiting" : live ? "running" : unread.has(chat.id) ? "done" : undefined;
  if (now === before) return;
  statuses = new Map(statuses);
  if (now) statuses.set(chat.id, now);
  else statuses.delete(chat.id);
  statusListeners.forEach((listener) => listener());
}

/** The chat on screen: it is read, and its status clears once it is done. */
export function setOpenChat(id: string | null) {
  openChatId = id;
  if (!id) return;
  unread.delete(id);
  const chat = chats.get(id);
  if (chat) {
    refreshStatus(chat);
    // Most recently opened last, for forgetting the oldest below.
    chats.delete(id);
    chats.set(id, chat);
  }
  forgetIdleChats();
}

// Opened chats stay in memory for quick switching, but not all of them: the
// oldest idle ones are dropped and load again from disk when opened.
const KEEP_CHATS = 12;

function forgetIdleChats() {
  if (chats.size <= KEEP_CHATS) return;
  const busy = new Set([...lanes.values()].map((lane) => lane.chatId));
  for (const [id, chat] of chats) {
    if (chats.size <= KEEP_CHATS) break;
    const idle =
      id !== openChatId &&
      !busy.has(id) &&
      !saves.has(id) &&
      !chatListeners.get(id)?.size &&
      !chat.compacting &&
      !chat.messages.some((message) => message.streaming || message.permissions?.length);
    if (idle) chats.delete(id);
  }
}

export function useChatStatuses(): Map<string, ChatStatus> {
  return useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    () => statuses,
  );
}

function upsertSummary(chat: Chat, keepPlace = false) {
  const entry = {
    id: chat.id,
    title: chat.title,
    updatedAt: chat.updatedAt,
    pinned: chat.pinned,
    projectId: chat.projectId ?? undefined,
    projectDir: chat.projectDir ?? undefined,
    branchOf: chat.branchOf ?? undefined,
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
  // Chats from before the modes: "allow all changes" becomes its mode.
  const mode: PermissionMode = chat.mode ?? (chat.autoEdits ? "acceptEdits" : DEFAULT_MODE);
  const clean = { ...chat, messages, compacting: false, mode, autoEdits: undefined };
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

// An answer changes its chat several times in a row (session, done, context,
// title); they are saved together, one save per chat at a time, so a large
// chat crosses to Rust once instead of each time.
const SAVE_DELAY_MS = 300;
const saves = new Map<string, { timer: number | null; running: boolean; again: boolean }>();

function persist(id: string) {
  const save = saves.get(id) ?? { timer: null, running: false, again: false };
  saves.set(id, save);
  if (save.timer !== null) clearTimeout(save.timer);
  save.timer = window.setTimeout(() => {
    save.timer = null;
    void saveNow(id);
  }, SAVE_DELAY_MS);
}

async function saveNow(id: string) {
  const save = saves.get(id);
  if (!save) return;
  if (save.running) {
    save.again = true;
    return;
  }
  const chat = chats.get(id);
  if (!chat || !chat.messages.length || deleting.has(id)) return void saves.delete(id);
  // Open approvals belong to the running engine, not to the saved chat.
  const messages = chat.messages.map((message) => (message.permissions ? { ...message, permissions: undefined } : message));
  save.running = true;
  await api.chatSave({ ...chat, messages }).catch(() => {});
  save.running = false;
  if (save.again) {
    save.again = false;
    await saveNow(id);
  } else if (save.timer === null) saves.delete(id);
}

/** Writes every save still waiting; before Rust asks which chats use a session. */
function flushSaves(): Promise<unknown> {
  const pending: Promise<void>[] = [];
  for (const [id, save] of saves) {
    if (save.timer === null) continue;
    clearTimeout(save.timer);
    save.timer = null;
    pending.push(saveNow(id));
  }
  return Promise.all(pending);
}

// Leaving the window writes what is still waiting.
window.addEventListener("pagehide", () => void flushSaves());

/** Chats being deleted; a save still on its way must not bring one back. */
const deleting = new Set<string>();

export async function deleteChat(id: string) {
  // Its branches must be on disk, or their sessions would look unused.
  await flushSaves();
  deleting.add(id);
  chats.delete(id);
  await api.chatDelete(id).finally(() => deleting.delete(id));
  summaries = summaries.filter((entry) => entry.id !== id);
  notifyGlobal();
}

function titleFrom(text: string, fallback: string) {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  if (!line) return fallback;
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}

/**
 * Changes the chat's own last answer. A second model's answer to the same
 * question may follow it; anything else after it means there is none.
 */
function updateLastAssistant(chat: Chat, change: (message: Message) => Message): Chat {
  let index = chat.messages.length - 1;
  while (index >= 0 && chat.messages[index].lane) index--;
  const last = chat.messages[index];
  if (!last || last.role !== "assistant") return chat;
  const messages = chat.messages.slice();
  messages[index] = change(last);
  return { ...chat, messages };
}

function updateMessage(chat: Chat, id: string, change: (message: Message) => Message): Chat {
  const index = chat.messages.findIndex((message) => message.id === id);
  if (index < 0) return chat;
  const messages = chat.messages.slice();
  messages[index] = change(messages[index]);
  return { ...chat, messages };
}

/** What the chat's own session has cost so far: its answers, not second models' ones. */
function sessionCost(messages: Message[]): number {
  return messages.reduce((sum, message) => sum + (message.lane ? 0 : (message.costUsd ?? 0)), 0);
}

/**
 * The session's running cost at the end of these messages, as Claude Code
 * reported it; older chats fall back to the sum of their answers. A resumed
 * or forked session continues from that total, so the next answer's own
 * cost is what comes on top.
 */
function costAt(messages: Message[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "assistant" && !message.lane && typeof message.sessionTotal === "number") return message.sessionTotal;
  }
  return sessionCost(messages);
}

/** Where the chat's session ends after these messages, for a second model to continue from. */
function lastTurnEnd(messages: Message[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "assistant" && !message.lane) return message.turnEnd ?? null;
  }
  return null;
}

/**
 * Second models' answers in flight: the engine knows each by its own id,
 * the window routes its events to the message in the chat.
 */
const lanes = new Map<string, { chatId: string; messageId: string }>();

/** Messages keep the error code, so the text follows the interface language. */
function errorCode(error: unknown): string {
  return typeof error === "string" && error.startsWith("error.") ? error : "error.generic";
}

type Outgoing = { name: string; mediaType: string; data: string };

/** Shows the user's message and an empty answer, then hands both to the engine. */
async function dispatch(
  chat: Chat,
  kept: Message[],
  text: string,
  attachments: Outgoing[],
  rewindTo?: string | null,
  format?: TemplateId,
) {
  const id = chat.id;
  // A rewind lets Rust check which chats still use the session; they must be on disk.
  if (rewindTo !== undefined) await flushSaves();
  const user: Message = {
    id: crypto.randomUUID(),
    role: "user",
    text,
    attachments: attachments.map(({ name, mediaType }) => ({ name, mediaType })),
  };
  const mode = chat.mode ?? DEFAULT_MODE;
  const reply: Message = {
    id: crypto.randomUUID(),
    role: "assistant",
    text: "",
    streaming: true,
    startedAt: Date.now(),
    plan: chat.projectDir && mode === "plan" ? true : undefined,
    format,
  };
  // A second model answers the same question next to it (not for redoing or templates).
  const rival = chat.compareModel && chat.compareModel !== chat.model && rewindTo === undefined && !format
    ? chat.compareModel
    : null;
  const laneReply: Message | null = rival
    ? { id: crypto.randomUUID(), role: "assistant", text: "", streaming: true, lane: true, model: rival, startedAt: reply.startedAt }
    : null;
  if (laneReply) reply.model = chat.model;
  const first = kept.length === 0;
  const next: Chat = {
    ...chat,
    // A template's chat is named after the template, not its long task text.
    title:
      first && !chat.titleLocked
        ? format
          ? t(TEMPLATES.find((entry) => entry.id === format)?.name ?? "app.newChat")
          : titleFrom(text, attachments[0]?.name ?? t("app.newChat"))
        : chat.title,
    // A new first question deserves a new generated title.
    titleRequested: first ? false : chat.titleRequested,
    updatedAt: Date.now(),
    messages: laneReply ? [...kept, user, reply, laneReply] : [...kept, user, reply],
  };
  putChat(next);
  upsertSummary(next);
  persist(id);
  // A branch's first message continues the session it branched off.
  const fork = next.forkFrom ?? null;
  const rewind = rewindTo !== undefined;
  // What the session behind this chat has cost so far, as Claude Code last
  // reported it: at the fork point, before a redone answer, or its latest total.
  const cost = fork ? (fork.total ?? sessionCost(kept)) : rewind ? costAt(kept) : (chat.sessionTotal ?? costAt(kept));
  const laneCost = fork ? cost : costAt(kept);
  const outgoing = attachments.map(({ name, mediaType, data }) => ({ name, mediaType, data }));
  const check = projectFor(next, projects)?.check ?? null;
  if (laneReply && rival) {
    const laneId = crypto.randomUUID();
    lanes.set(laneId, { chatId: id, messageId: laneReply.id });
    // In a project the second model works in its own copy, with the chat's
    // mode, approvals and check, so both answers can change files.
    const projectDir = next.projectDir ?? null;
    void (projectDir ? api.workcopyCreate(projectDir) : Promise.resolve(null))
      .then((laneDir) => {
        if (laneDir) {
          updateChat(id, (current) => updateMessage(current, laneReply.id, (message) => ({ ...message, laneDir })));
          persist(id);
        }
        return api.chatSend({
        chatId: laneId,
        sessionId: fork?.sessionId ?? next.sessionId,
        model: rival,
        effort: next.effort,
        web: next.web,
        text,
        attachments: outgoing,
        costSoFar: laneCost,
        fork: true,
        lane: true,
        rewindTo: fork?.at ?? lastTurnEnd(kept),
        projectDir: laneDir,
        mode,
        check: laneDir ? check : null,
        });
      })
      .then((engine) => updateChat(id, (current) => updateMessage(current, laneReply.id, (message) => ({ ...message, engine }))))
      .catch((error) => {
        lanes.delete(laneId);
        updateChat(id, (current) =>
          updateMessage(current, laneReply.id, (message) => ({ ...message, streaming: false, error: errorCode(error) })),
        );
      });
  }
  try {
    const engine = await api.chatSend({
      chatId: id,
      sessionId: fork ? fork.sessionId : next.sessionId,
      model: next.model,
      effort: next.effort,
      web: next.web,
      text,
      attachments: outgoing,
      costSoFar: cost,
      rewind: rewind && !fork,
      fork: Boolean(fork),
      rewindTo: fork ? fork.at : (rewindTo ?? null),
      projectDir: next.projectDir ?? null,
      mode,
      check,
      format: format ?? null,
      userUuid: user.id,
      reverted: Boolean(chat.reverted),
    });
    // The fork point stays until the branch's own session exists (its `session` event).
    updateChat(id, (current) => ({
      ...updateLastAssistant(current, (message) => (message.id === reply.id ? { ...message, engine } : message)),
      reverted: false,
    }));
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

/** Runs a template: its task as the message, its fixed format for the answer. */
export async function runTemplate(id: string, template: TemplateId, text: string) {
  const chat = chats.get(id);
  if (chat) await dispatch(chat, chat.messages, text, [], undefined, template);
}

/** Each question also goes to another model (or no longer, with `null`). */
export function setCompareModel(id: string, model: ModelId | null) {
  updateChat(id, (chat) => ({ ...chat, compareModel: model }));
  persist(id);
}

/**
 * A new chat that continues this one from an answer: the conversation up to
 * it is copied, and its first message continues a copy of the session there.
 * A second model's answer can be continued the same way. Returns its id.
 */
export function branchChat(id: string, messageId: string): string | null {
  const chat = chats.get(id);
  if (!chat) return null;
  const index = chat.messages.findIndex((message) => message.id === messageId);
  const answer = chat.messages[index];
  if (!answer || answer.role !== "assistant" || answer.streaming) return null;
  const sessionId = answer.lane ? answer.laneSession : chat.sessionId;
  const at = answer.lane ? answer.laneTurnEnd : answer.turnEnd;
  const total = answer.lane ? answer.laneTotal : answer.sessionTotal;
  if (!sessionId || !at) return null;
  // Up to the answer; for a second model's answer, without the chat's own one next to it.
  let kept = chat.messages.slice(0, index + 1);
  if (answer.lane) kept = kept.filter((message, position) => position === index || !(position === index - 1 && message.role === "assistant"));
  // Turn marks and second-model sessions belong to the original chat.
  const messages = kept.map((message) => ({
    ...message,
    lane: message.id === answer.id ? undefined : message.lane,
    turnEnd: undefined,
    laneSession: undefined,
    laneTurnEnd: undefined,
    laneTotal: undefined,
    sessionTotal: undefined,
    checkpoint: undefined,
    permissions: undefined,
  }));
  const now = Date.now();
  const branch: Chat = {
    ...chat,
    id: crypto.randomUUID(),
    title: t("branch.title", { title: chat.title.replace(/ \((Zweig|branch)\)$/, "") }),
    createdAt: now,
    updatedAt: now,
    model: answer.lane && answer.model ? answer.model : chat.model,
    sessionId: null,
    sessionTotal: null,
    forkFrom: { sessionId, at, total },
    branchOf: chat.branchOf ?? chat.id,
    costUsd: 0,
    messages,
    titleLocked: true,
    pinned: false,
    compareModel: null,
    compacting: false,
    reverted: false,
  };
  putChat(branch);
  upsertSummary(branch);
  persist(branch.id);
  return branch.id;
}

/** Undoes the file changes Claude made from this answer's question on (file checkpoints). */
export async function revertChanges(id: string, answerId: string) {
  const chat = chats.get(id);
  if (!chat?.sessionId || !chat.projectDir) return;
  const index = chat.messages.findIndex((message) => message.id === answerId);
  const question = chat.messages.slice(0, index).reverse().find((message) => message.role === "user");
  if (!question) return;
  try {
    await api.chatRevertFiles({
      chatId: id,
      sessionId: chat.sessionId,
      messageId: question.id,
      model: chat.model,
      effort: chat.effort,
      web: chat.web,
      projectDir: chat.projectDir,
      mode: chat.mode ?? DEFAULT_MODE,
      costSoFar: chat.sessionTotal ?? costAt(chat.messages),
    });
  } catch (error) {
    updateChat(id, (current) => withNote(current, { id: crypto.randomUUID(), role: "note", text: "", error: errorCode(error) }));
  }
}

/** Sets the command a project runs after Claude changed files; empty turns it off. */
export async function setProjectCheck(projectId: string, check: string) {
  await api.projectSetCheck(projectId, check);
  const clean = check.trim();
  projects = projects.map((project) => (project.id === projectId ? { ...project, check: clean || undefined } : project));
  notifyGlobal();
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
  // Not after a template, a comparison or a branch's first answers.
  if (!last || last.role !== "assistant" || last.streaming || last.lane || last.format) return undefined;
  if (!question || question.role !== "user" || question.attachments?.length) return undefined;
  if (chat.forkFrom || (chat.branchOf && !last.turnEnd)) return undefined;
  if (count === 2) return null;
  const before = chat.messages.slice(0, count - 2).reverse().find((message) => message.role === "assistant" && !message.lane);
  return before ? (before.turnEnd ?? undefined) : null;
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
  // Stopped means stopped: waiting messages stay until sent by hand.
  if (queues.has(id)) halted.add(id);
  void api.chatStop(id);
  for (const [laneId, lane] of lanes) if (lane.chatId === id) void api.chatStop(laneId);
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
/** Where something new goes in an answer: after its text so far and after everything that came before. */
export function placeIn(message: Message): { textAt: number; step: number } {
  return {
    textAt: message.text.length,
    step: (message.tools?.length ?? 0) + (message.artifacts?.length ?? 0) + (message.steers?.length ?? 0),
  };
}

/** A message with one of its tools changed. */
/** A list of steps with one of them changed, wherever it sits among the helpers' steps. */
function changeTools(tools: ToolUse[], toolId: string, change: (tool: ToolUse) => ToolUse): ToolUse[] | null {
  let found = false;
  const next = tools.map((tool) => {
    if (found) return tool;
    if (tool.id === toolId) {
      found = true;
      return change(tool);
    }
    const children = tool.children && changeTools(tool.children, toolId, change);
    if (!children) return tool;
    found = true;
    return { ...tool, children };
  });
  return found ? next : null;
}

function withTool(message: Message, toolId: string | null | undefined, change: (tool: ToolUse) => ToolUse): Message {
  const tools = toolId && message.tools ? changeTools(message.tools, toolId, change) : null;
  return tools ? { ...message, tools } : message;
}

function updateTool(chat: Chat, toolId: string | null | undefined, change: (tool: ToolUse) => ToolUse): Chat {
  if (!toolId) return chat;
  return updateLastAssistant(chat, (message) => withTool(message, toolId, change));
}

/** A new step: Claude's own in order with the text, a helper's under the call that started it. */
function addTool(message: Message, event: { id?: string; parent?: string; name: string; detail: string }): Message {
  const tool: ToolUse = { id: event.id, name: event.name, detail: event.detail };
  if (event.parent) {
    const tools = message.tools && changeTools(message.tools, event.parent, (call) => ({ ...call, children: [...(call.children ?? []), tool] }));
    if (tools) return { ...message, tools };
  }
  return { ...message, tools: [...(message.tools ?? []), { ...tool, ...placeIn(message) }] };
}

/** The answer to an approval of a second model's answer, which runs as its own engine chat. */
export function answerLanePermission(chatId: string, messageId: string, request: PermissionRequest, decision: PermissionDecision) {
  const laneId = [...lanes].find(([, lane]) => lane.chatId === chatId && lane.messageId === messageId)?.[0];
  updateChat(chatId, (chat) =>
    updateMessage(chat, messageId, (message) =>
      withTool(
        { ...message, permissions: message.permissions?.filter((entry) => entry.id !== request.id) },
        request.toolUseId,
        (tool) =>
          decision === "deny"
            ? { ...tool, denied: true }
            : request.tool === "Edit" || request.tool === "Write"
              ? { ...tool, change: storedChange(request) }
              : tool,
      ),
    ),
  );
  if (laneId) void api.chatPermission(laneId, request.id, decision).catch(() => {});
}

/**
 * Takes a second model's changes over into the project (`force` replaces
 * files the project changed meanwhile), or drops them. The copy stays while
 * files are left out.
 */
export async function finishWorkcopy(chatId: string, messageId: string, take: boolean, force: string[] = []) {
  const chat = chats.get(chatId);
  const message = chat?.messages.find((entry) => entry.id === messageId);
  if (!chat?.projectDir || !message?.laneDir) return null;
  const result = take ? await api.workcopyApply(message.laneDir, chat.projectDir, force) : (await api.workcopyDiscard(message.laneDir), null);
  if (!result || result.conflicts.length === 0) {
    updateChat(chatId, (current) =>
      updateMessage(current, messageId, (entry) => ({ ...entry, laneDone: take ? "applied" : "discarded" })),
    );
    persist(chatId);
  }
  return result;
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
        : request.tool === "Edit" || request.tool === "Write"
          ? { ...tool, change: storedChange(request) }
          : tool,
    );
    if (decision === "always" && (request.tool === "Edit" || request.tool === "Write") && next.mode === "default") {
      next = { ...next, mode: "acceptEdits" };
    }
    return next;
  });
  void api.chatPermission(chatId, request.id, decision).catch(() => {});
}

/** Switches how far Claude may go without asking; a running answer follows at once. */
export function setMode(chatId: string, mode: PermissionMode) {
  updateChat(chatId, (chat) => ({ ...chat, mode }));
  persist(chatId);
  void api.chatMode(chatId, mode).catch(() => {});
}

// ───────── Messages while an answer runs ─────────
// Written while Claude works, a message waits in the chat's queue and goes out
// as soon as everything has finished. "Send now" puts it into the running
// answer instead: Claude takes it in at its next step.

export interface Queued {
  id: string;
  text: string;
  attachments: Outgoing[];
}

const queues = new Map<string, Queued[]>();
const queueListeners = new Set<() => void>();
const EMPTY_QUEUE: Queued[] = [];

function setQueue(chatId: string, queue: Queued[]) {
  if (queue.length) queues.set(chatId, queue);
  else queues.delete(chatId);
  queueListeners.forEach((listener) => listener());
}

export function useQueue(chatId: string): Queued[] {
  return useSyncExternalStore(
    (listener) => {
      queueListeners.add(listener);
      return () => queueListeners.delete(listener);
    },
    () => queues.get(chatId) ?? EMPTY_QUEUE,
  );
}

export function queueMessage(chatId: string, text: string, attachments: Outgoing[]) {
  halted.delete(chatId);
  setQueue(chatId, [...(queues.get(chatId) ?? []), { id: crypto.randomUUID(), text, attachments }]);
  drainQueue(chatId);
}

export function removeQueued(chatId: string, id: string) {
  setQueue(chatId, (queues.get(chatId) ?? []).filter((entry) => entry.id !== id));
}

/** Whether anything still runs in the chat: an answer, a compaction, or messages sent into one. */
function chatBusy(chat: Chat): boolean {
  return Boolean(
    chat.compacting || chat.messages.some((message) => message.streaming || message.steers?.some((steer) => !steer.taken)),
  );
}

/** Chats stopped by hand; their queue waits for the user. */
const halted = new Set<string>();

/** Sends the next waiting message once nothing runs any more. */
function drainQueue(chatId: string) {
  const chat = chats.get(chatId);
  const [next, ...rest] = queues.get(chatId) ?? [];
  if (!chat || !next || chatBusy(chat) || halted.has(chatId)) return;
  setQueue(chatId, rest);
  void sendMessage(chatId, next.text, next.attachments);
}

/** "Send now": a waiting message goes into the running answer. Text only. */
export function steerNow(chatId: string, id: string) {
  const chat = chats.get(chatId);
  const entry = queues.get(chatId)?.find((item) => item.id === id);
  if (!chat || !entry) return;
  const running = chat.messages.some((message) => message.streaming && !message.lane);
  // Into a running answer goes text only.
  if (running && (entry.attachments.length || !entry.text.trim())) return;
  halted.delete(chatId);
  removeQueued(chatId, id);
  if (!running) {
    // Nothing to send it into (or only the compared model still writes): it goes out as a message.
    if (chatBusy(chat)) setQueue(chatId, [entry, ...(queues.get(chatId) ?? [])]);
    else void sendMessage(chatId, entry.text, entry.attachments);
    return;
  }
  updateChat(chatId, (current) =>
    updateLastAssistant(current, (message) => ({
      ...message,
      steers: [...(message.steers ?? []), { id, text: entry.text, ...placeIn(message) }],
    })),
  );
  persist(chatId);
  api.chatSteer(chatId, id, entry.text).catch(() => onEngineEvent({ type: "steerReturned", chatId, id }));
}

/** Changes the message that holds a steer. */
function withSteer(chat: Chat, id: string, change: (message: Message, steer: Steer) => Message): Chat {
  const index = chat.messages.findIndex((message) => message.steers?.some((steer) => steer.id === id));
  if (index < 0) return chat;
  const messages = chat.messages.slice();
  const message = messages[index];
  messages[index] = change(message, message.steers!.find((steer) => steer.id === id)!);
  return { ...chat, messages };
}

/** Carries out the plan of the last answer in the given mode. */
export async function implementPlan(chatId: string, mode: PermissionMode) {
  setMode(chatId, mode);
  await sendMessage(chatId, t("plan.go"), []);
}

type EngineEvent =
  | { type: "session"; chatId: string; sessionId: string }
  | { type: "delta"; chatId: string; text: string; thinking: string }
  | { type: "tool"; chatId: string; id?: string; parent?: string; name: string; detail: string }
  | { type: "artifact"; chatId: string; artifact: Artifact }
  | { type: "toolResult"; chatId: string; id: string; failed: boolean; output: string }
  | ({ type: "permission"; chatId: string } & PermissionRequest)
  | { type: "permissionGone"; chatId: string; id: string }
  | ({ type: "change"; chatId: string } & PermissionRequest)
  | { type: "mode"; chatId: string; mode: PermissionMode; reason?: "autoUnavailable" }
  | { type: "filesReverted"; chatId: string; messageId: string; files: string[]; error: string | null }
  | {
      type: "done";
      chatId: string;
      sessionId?: string;
      costUsd: number;
      turnEnd?: string | null;
      total?: number;
      structured?: unknown;
      error: string | null;
    }
  | { type: "steered"; chatId: string; id: string }
  | { type: "steerTurn"; chatId: string; id: string }
  | { type: "steerReturned"; chatId: string; id: string }
  | { type: "idle"; chatId: string }
  | { type: "title"; chatId: string; title: string }
  | { type: "context"; chatId: string; used: number; window: number; categories?: ContextCategory[] }
  | { type: "compacting"; chatId: string }
  | { type: "compacted"; chatId: string; trigger: "manual" | "auto"; before: number | null; after: number | null }
  | { type: "compactDone"; chatId: string; costUsd: number; total?: number; error: string | null }
  | { type: "fatal"; message: string; generation: number }
  | { type: "exit"; generation: number }
  | { type: "ready" };

/**
 * Adds a note to the thread: before an answer that is still streaming (an
 * automatic compaction runs before it), otherwise at the end. Answers before
 * a compaction can no longer be rewound to, so `compacted` drops their marks.
 */
function withNote(chat: Chat, note: Message, compacted = false): Chat {
  const messages = compacted
    ? chat.messages.map((message) => (message.turnEnd ? { ...message, turnEnd: null } : message))
    : chat.messages.slice();
  const running = messages.findIndex((message) => message.streaming && !message.lane);
  if (running >= 0) messages.splice(running, 0, note);
  else messages.push(note);
  return { ...chat, messages };
}

/** Summarizes the chat's conversation to free context. */
export async function compactChat(id: string) {
  const chat = chats.get(id);
  if (!chat || !chat.sessionId || chat.compacting) return;
  if (chat.messages.slice(-3).some((message) => message.streaming)) return;
  putChat({ ...chat, compacting: true });
  try {
    await api.chatCompact({
      chatId: id,
      sessionId: chat.sessionId,
      model: chat.model,
      effort: chat.effort,
      web: chat.web,
      costSoFar: chat.sessionTotal ?? costAt(chat.messages),
      projectDir: chat.projectDir ?? null,
      mode: chat.mode ?? DEFAULT_MODE,
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
    if (!chat.messages.some((message) => message.streaming && message.engine === generation)) continue;
    const messages = chat.messages.map((message) =>
      message.streaming && message.engine === generation
        ? { ...message, streaming: false, permissions: undefined, error: reason }
        : message,
    );
    putChat({ ...chat, messages });
    persist(chat.id);
  }
  for (const [laneId, lane] of lanes) if (!chats.get(lane.chatId)?.messages.some((m) => m.id === lane.messageId && m.streaming)) lanes.delete(laneId);
}

/** Events of a second model's answer: text, steps and its end; the rest is the chat's own business. */
function onLaneEvent(lane: { chatId: string; messageId: string }, laneId: string, event: EngineEvent) {
  const change = (update: (message: Message) => Message) =>
    updateChat(lane.chatId, (chat) => updateMessage(chat, lane.messageId, update));
  switch (event.type) {
    case "artifact":
      change((message) => ({ ...message, artifacts: [...(message.artifacts ?? []), { ...event.artifact, ...placeIn(message) }] }));
      return;
    case "session":
      change((message) => ({ ...message, laneSession: event.sessionId }));
      persist(lane.chatId);
      return;
    case "delta":
      change((message) => ({
        ...message,
        text: message.text + event.text,
        thinking: event.thinking ? (message.thinking ?? "") + event.thinking : message.thinking,
      }));
      return;
    case "tool":
      change((message) => addTool(message, event));
      return;
    case "toolResult":
      change((message) =>
        withTool(message, event.id, (tool) => ({ ...tool, failed: event.failed && !tool.denied, output: event.output || tool.output })),
      );
      return;
    case "change": {
      const { type: _type, chatId: _chatId, ...request } = event;
      change((message) => withTool(message, request.toolUseId, (tool) => ({ ...tool, change: storedChange(request) })));
      return;
    }
    case "permission": {
      const { type: _type, chatId: _chatId, ...request } = event;
      change((message) =>
        message.streaming
          ? { ...message, permissions: [...(message.permissions ?? []).filter((entry) => entry.id !== request.id), request] }
          : message,
      );
      return;
    }
    case "permissionGone":
      change((message) => ({ ...message, permissions: message.permissions?.filter((entry) => entry.id !== event.id) }));
      return;
    case "done":
      lanes.delete(laneId);
      change((message) => ({
        ...message,
        streaming: false,
        durationMs: message.startedAt ? Date.now() - message.startedAt : undefined,
        costUsd: (message.costUsd ?? 0) + event.costUsd,
        laneTurnEnd: event.turnEnd ?? null,
        laneTotal: typeof event.total === "number" ? event.total : null,
        laneSession: event.sessionId ?? message.laneSession,
        error: event.error,
      }));
      updateChat(lane.chatId, (chat) => ({ ...chat, costUsd: chat.costUsd + event.costUsd }));
      persist(lane.chatId);
      drainQueue(lane.chatId);
      return;
    default:
      return;
  }
}

function onEngineEvent(event: EngineEvent) {
  const lane = "chatId" in event ? lanes.get(event.chatId) : undefined;
  if (lane && "chatId" in event) {
    onLaneEvent(lane, event.chatId, event);
    return;
  }
  switch (event.type) {
    case "session":
      // Saved at once: after a crash mid-answer the chat still knows its session.
      // A branch's fork point is used up now that its own session exists.
      updateChat(event.chatId, (chat) => ({ ...chat, sessionId: event.sessionId, forkFrom: null }));
      persist(event.chatId);
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
    case "artifact":
      updateChat(event.chatId, (chat) =>
        updateLastAssistant(chat, (message) => ({ ...message, artifacts: [...(message.artifacts ?? []), { ...event.artifact, ...placeIn(message) }] })),
      );
      return;
    case "tool":
      updateChat(event.chatId, (chat) =>
        // Where in the text it happened, so the answer shows text and steps in order.
        updateLastAssistant(chat, (message) => addTool(message, event)),
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
    case "mode":
      updateChat(event.chatId, (chat) => {
        const next = { ...chat, mode: event.mode };
        return event.reason === "autoUnavailable"
          ? withNote(next, { id: crypto.randomUUID(), role: "note", text: "note.autoUnavailable" })
          : next;
      });
      persist(event.chatId);
      return;
    case "filesReverted":
      updateChat(event.chatId, (chat) => {
        if (event.error) return withNote(chat, { id: crypto.randomUUID(), role: "note", text: "", error: event.error });
        // The question's answer and every one after it lose their changes.
        const from = chat.messages.findIndex((message) => message.id === event.messageId);
        const messages = chat.messages.map((message, index) =>
          index > from && message.role === "assistant" && allTools(message.tools).some((tool) => tool.change)
            ? { ...message, reverted: true }
            : message,
        );
        return withNote(
          { ...chat, messages, reverted: true },
          {
            id: crypto.randomUUID(),
            role: "note",
            text: event.files.length
              ? t("revert.done", {
                  files: event.files.slice(0, 3).join(", ") + (event.files.length > 3 ? ` +${event.files.length - 3}` : ""),
                })
              : t("revert.nothing"),
          },
        );
      });
      persist(event.chatId);
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
          durationMs: message.startedAt ? Date.now() - message.startedAt : message.durationMs,
          costUsd: (message.costUsd ?? 0) + event.costUsd,
          turnEnd: event.turnEnd ?? null,
          sessionTotal: typeof event.total === "number" ? event.total : message.sessionTotal,
          // A finished answer in a project session has file checkpoints to undo.
          checkpoint: Boolean(chat.projectDir && event.turnEnd) || message.checkpoint,
          structured: event.structured ?? message.structured,
          error: event.error,
        })),
        sessionId: event.sessionId ?? chat.sessionId,
        sessionTotal: typeof event.total === "number" ? event.total : chat.sessionTotal,
        costUsd: chat.costUsd + event.costUsd,
        compacting: false,
        updatedAt: Date.now(),
      }));
      persist(event.chatId);
      {
        const chat = chats.get(event.chatId);
        if (chat) requestTitle(chat);
      }
      drainQueue(event.chatId);
      return;
    case "steered":
      updateChat(event.chatId, (chat) =>
        withSteer(chat, event.id, (message) => ({
          ...message,
          steers: message.steers!.map((steer) => (steer.id === event.id ? { ...steer, taken: true } : steer)),
        })),
      );
      persist(event.chatId);
      return;
    case "steerTurn": {
      // The answer ended before taking the message in; it gets an answer of its
      // own, shown as a question and answer like any other.
      const chat = chats.get(event.chatId);
      const holder = chat?.messages.find((message) => message.steers?.some((steer) => steer.id === event.id));
      const steer = holder?.steers?.find((entry) => entry.id === event.id);
      if (!chat || !steer) return;
      const question: Message = { id: crypto.randomUUID(), role: "user", text: steer.text };
      const answer: Message = { id: crypto.randomUUID(), role: "assistant", text: "", streaming: true, startedAt: Date.now() };
      updateChat(event.chatId, (current) => {
        const moved = withSteer(current, event.id, (message) => ({
          ...message,
          steers: message.steers!.filter((entry) => entry.id !== event.id),
        }));
        return { ...moved, messages: [...moved.messages, question, answer], updatedAt: Date.now() };
      });
      persist(event.chatId);
      return;
    }
    case "steerReturned": {
      // Nothing ran any more: it waits in the queue again, first in line.
      const chat = chats.get(event.chatId);
      const steer = chat?.messages.flatMap((message) => message.steers ?? []).find((entry) => entry.id === event.id);
      if (!steer) return;
      updateChat(event.chatId, (current) =>
        withSteer(current, event.id, (message) => ({
          ...message,
          steers: message.steers!.filter((entry) => entry.id !== event.id),
        })),
      );
      setQueue(event.chatId, [{ id: steer.id, text: steer.text, attachments: [] }, ...(queues.get(event.chatId) ?? [])]);
      persist(event.chatId);
      drainQueue(event.chatId);
      return;
    }
    case "idle":
      drainQueue(event.chatId);
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
      }, true));
      persist(event.chatId);
      return;
    case "compactDone":
      updateChat(event.chatId, (chat) => {
        const next = {
          ...chat,
          compacting: false,
          costUsd: chat.costUsd + event.costUsd,
          sessionTotal: typeof event.total === "number" ? event.total : chat.sessionTotal,
        };
        return event.error ? withNote(next, { id: crypto.randomUUID(), role: "note", text: "", error: event.error }) : next;
      });
      persist(event.chatId);
      drainQueue(event.chatId);
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
