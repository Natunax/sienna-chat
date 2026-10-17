import { openUrl } from "@tauri-apps/plugin-opener";
import { cloneElement, useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent } from "react";
import {
  DEFAULT_MODE,
  formatUsd,
  MODELS,
  type Artifact,
  type Chat,
  type OutgoingAttachment,
  type PermissionDecision,
  type PermissionMode,
  type PermissionRequest,
} from "../api";
import { t, useLanguage, type TextKey } from "../i18n";
import { ArtifactPanel } from "./ArtifactPanel";
import { SidePanel, type SideTab } from "./SidePanel";
import { ArtifactCompare, type CompareSide } from "./ArtifactCompare";
import { WorkcopyBar } from "./WorkcopyBar";
import {
  answerLanePermission,
  answerPermission,
  branchChat,
  compactChat,
  implementPlan,
  projectFor,
  redoLast,
  revertChanges,
  rewindPoint,
  runTemplate,
  sendMessage,
  setCompareModel,
  setProjectCheck,
  setMode,
  stopMessage,
  updateChat,
  useProjects,
  useSummaries,
} from "../store";
import { Composer, type ComposerSettings } from "./Composer";
import { ChevronDownIcon, PanelRightIcon, SidebarIcon } from "./icons";
import { MessageView } from "./MessageView";

/** The empty chat greets by time of day. */
function greeting(hour: number): TextKey {
  if (hour >= 5 && hour < 11) return "chat.greetMorning";
  if (hour >= 11 && hour < 18) return "chat.greetDay";
  if (hour >= 18 && hour < 23) return "chat.greetEvening";
  return "chat.greetNight";
}

interface Props {
  chat: Chat;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onSettingsChange: (settings: ComposerSettings) => void;
  /** Opens another chat, such as a new branch. */
  onOpenChat: (id: string) => void;
}

/** Keeps the view pinned to the newest text unless the reader scrolled up. */
function useStickToBottom(dependency: unknown) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(() => {
      if (stuck.current) el.scrollTop = el.scrollHeight;
    });
    if (content.current) observer.observe(content.current);
    return () => {
      el.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    stuck.current = true;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [dependency]);

  return { scroller, content, stuck };
}

export function ChatView({ chat, sidebarOpen, onToggleSidebar, onSettingsChange, onOpenChat }: Props) {
  const [dragging, setDragging] = useState(false);
  // Opening a chat shows its messages at once; only new ones rise in.
  const [opening, setOpening] = useState(true);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpening(false));
    return () => cancelAnimationFrame(frame);
  }, []);
  const [dropped, setDropped] = useState<File[]>([]);
  const { scroller, content, stuck } = useStickToBottom(chat.id);
  // The last answer and a second model's next to it; while the conversation
  // is being compacted, nothing new can be sent either.
  const lastQuestionAt = chat.messages.map((message) => message.role).lastIndexOf("user");
  const streaming =
    chat.messages.slice(Math.max(0, lastQuestionAt)).some((message) => message.streaming) || Boolean(chat.compacting);
  const empty = chat.messages.length === 0;
  // Claude waits for an approval; the composer says so.
  const waiting = chat.messages.slice(Math.max(0, lastQuestionAt)).some((message) => message.permissions?.length);
  const language = useLanguage();
  const project = projectFor(chat, useProjects());
  const firstRun = useSummaries().length === 0;

  const settings: ComposerSettings = { model: chat.model, effort: chat.effort, web: chat.web };

  const changeSettings = (change: Partial<ComposerSettings>) => {
    const next = { ...settings, ...change };
    updateChat(chat.id, (current) => ({ ...current, ...change }));
    onSettingsChange(next);
  };

  // Only the last question and answer can be replaced; a stable callback keeps
  // the memoized older messages from re-rendering.
  const canRedo = rewindPoint(chat) !== undefined;
  const redo = useCallback(
    (text?: string) => {
      stuck.current = true;
      void redoLast(chat.id, text);
    },
    [chat.id, stuck],
  );
  const lastQuestion = chat.messages.length - 2;
  const answer = useCallback(
    (request: PermissionRequest, decision: PermissionDecision) => answerPermission(chat.id, request, decision),
    [chat.id],
  );
  const branch = useCallback(
    (messageId: string) => {
      const id = branchChat(chat.id, messageId);
      if (id) onOpenChat(id);
    },
    [chat.id, onOpenChat],
  );
  const followUp = useCallback(
    (text: string) => {
      stuck.current = true;
      void sendMessage(chat.id, text, []);
    },
    [chat.id, stuck],
  );
  const revert = useCallback((messageId: string) => void revertChanges(chat.id, messageId), [chat.id]);
  // The chat's own last answer; a second model's may follow it.
  let ownLast = chat.messages.length - 1;
  while (ownLast > 0 && chat.messages[ownLast].lane) ownLast--;
  const implement = useCallback(
    (mode: PermissionMode) => {
      stuck.current = true;
      void implementPlan(chat.id, mode);
    },
    [chat.id, stuck],
  );

  const chatRef = useRef(chat);
  chatRef.current = chat;
  // The artifact open next to the chat: its id and version (null follows the newest).
  // The chat's own answers and a second model's keep separate versions of an id.
  const [shown, setShown] = useState<{ id: string; lane: boolean; version: number | null } | null>(null);
  // The side panel and its tab; an artifact opens in it.
  const [side, setSide] = useState<SideTab | null>(null);
  const [lastTab, setLastTab] = useState<SideTab>("artifacts");
  const sideRef = useRef(side);
  sideRef.current = side;
  const showTab = useCallback((tab: SideTab | null) => {
    setSide(tab);
    if (tab) setLastTab(tab);
  }, []);
  const versionsIn = (messages: Chat["messages"], id: string, lane: boolean) =>
    messages.flatMap((message) =>
      Boolean(message.lane) === lane ? (message.artifacts ?? []).filter((entry) => entry.id === id) : [],
    );
  const openArtifact = useCallback((id: string, artifact: Artifact) => {
    const messages = chatRef.current.messages;
    const lane = Boolean(messages.find((message) => message.artifacts?.includes(artifact))?.lane);
    const all = versionsIn(messages, id, lane);
    const at = all.indexOf(artifact);
    setShown({ id, lane, version: at < 0 || at === all.length - 1 ? null : at });
    showTab("artifacts");
  }, [showTab]);
  // A new artifact in the running answer opens by itself, as in Claude; the
  // chat's own answer wins over a second model's.
  const recent = chat.messages.slice(lastQuestionAt + 1);
  const newestOwn = recent.find((message) => !message.lane)?.artifacts?.at(-1);
  const newestLane = recent.find((message) => message.lane)?.artifacts?.at(-1);
  const newest = newestOwn ?? newestLane;
  useEffect(() => {
    if (!newest || !streaming) return;
    setShown({ id: newest.id, lane: !newestOwn, version: null });
    // Another tab the reader chose stays; the artifacts tab counts the new one.
    if (!sideRef.current || sideRef.current === "artifacts") showTab("artifacts");
  }, [newest, streaming]);
  const shownVersions = shown ? versionsIn(chat.messages, shown.id, shown.lane) : [];

  // Two compared answers' artifacts side by side: the last one each made.
  const [comparing, setComparing] = useState<{ own: string; lane: string } | null>(null);
  // Compared answers the reader unfolded, by the chat's own answer.
  const [openPairs, setOpenPairs] = useState<ReadonlySet<string>>(new Set());
  const togglePair = (id: string) =>
    setOpenPairs((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const sideOf = (messageId: string): CompareSide | null => {
    const message = chat.messages.find((entry) => entry.id === messageId);
    const artifact = message?.artifacts?.at(-1);
    if (!message || !artifact) return null;
    const versions = versionsIn(chat.messages, artifact.id, Boolean(message.lane));
    return {
      model: MODELS.find((entry) => entry.id === (message.model ?? chat.model))?.name ?? message.model ?? "",
      durationMs: message.durationMs,
      costUsd: message.costUsd,
      versions,
      start: Math.max(0, versions.indexOf(artifact)),
    };
  };
  const compareSides = comparing ? [sideOf(comparing.own), sideOf(comparing.lane)] : null;
  // Stable callbacks, so compared answers stay memoized while another streams.
  const compareArtifacts = useCallback((ownId: string) => {
    const messages = chatRef.current.messages;
    const lane = messages[messages.findIndex((message) => message.id === ownId) + 1];
    if (!lane?.lane) return;
    setShown(null);
    setComparing({ own: ownId, lane: lane.id });
  }, []);
  const answerLane = useCallback(
    (request: PermissionRequest, decision: PermissionDecision, messageId: string) =>
      answerLanePermission(chat.id, messageId, request, decision),
    [chat.id],
  );
  const closeCompare = useCallback(() => setComparing(null), []);
  // The last plan can be carried out while nothing runs.
  const lastPlan = chat.messages[ownLast];
  const canImplement = Boolean(lastPlan?.plan && lastPlan.text && !lastPlan.error && !streaming);

  const send = (text: string, attachments: OutgoingAttachment[]) => {
    stuck.current = true;
    void sendMessage(chat.id, text, attachments);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && event.key === "." && streaming) {
        event.preventDefault();
        stopMessage(chat.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chat.id, streaming]);

  // Links open in the default browser; code blocks get a copy button.
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const link = target.closest("a");
    if (link) {
      event.preventDefault();
      const href = link.getAttribute("href") ?? "";
      if (/^https?:\/\//i.test(href)) void openUrl(href);
      return;
    }
    const copy = target.closest<HTMLButtonElement>(".code-copy");
    if (copy) {
      const code = copy.closest("pre")?.querySelector("code")?.textContent ?? "";
      void navigator.clipboard.writeText(code).then(() => {
        copy.textContent = t("code.copied");
        setTimeout(() => (copy.textContent = t("code.copy")), 1400);
      });
    }
  };

  const onDragOver = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragging(true);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    setDropped(Array.from(event.dataTransfer.files));
  };

  const composer = (
    <Composer
      settings={settings}
      onSettings={changeSettings}
      streaming={streaming}
      waiting={waiting}
      onSend={send}
      onStop={() => stopMessage(chat.id)}
      autoFocusKey={chat.id}
      pendingFiles={dropped}
      onFilesTaken={() => setDropped([])}
      project={chat.projectDir ?? null}
      // A chat's session lives in its folder, so the folder is set before the first message.
      projectLocked={!empty}
      context={chat.context}
      compacting={Boolean(chat.compacting)}
      onCompact={chat.sessionId && !streaming ? () => void compactChat(chat.id) : undefined}
      mode={chat.mode ?? DEFAULT_MODE}
      onMode={(mode) => setMode(chat.id, mode)}
      compareModel={chat.compareModel ?? null}
      onCompare={(model) => setCompareModel(chat.id, model)}
      check={project?.check ?? null}
      onCheck={project ? (command) => setProjectCheck(project.id, command) : undefined}
      conversation={chat.messages.some((message) => message.role === "assistant" && !message.streaming)}
      onTemplate={(id, text) => {
        stuck.current = true;
        void runTemplate(chat.id, id, text);
      }}
      onProject={(picked) =>
        updateChat(chat.id, (current) => ({
          ...current,
          projectId: picked?.id ?? null,
          projectDir: picked?.path ?? null,
        }))
      }
    />
  );

  return (
    <div className="chat-area">
    <main
      className="chat"
      onDragOver={onDragOver}
      onDragLeave={(event) => event.currentTarget === event.target && setDragging(false)}
      onDrop={onDrop}
    >
      <header className={`chat-header${sidebarOpen ? "" : " is-collapsed"}`} data-tauri-drag-region>
        {!sidebarOpen && (
          <button type="button" className="icon-button" onClick={onToggleSidebar} aria-label={t("sidebar.show")} title={t("sidebar.shortcut")}>
            <SidebarIcon />
          </button>
        )}
        <h1 className="chat-title" data-tauri-drag-region>
          {project && (
            <span className="chat-project" data-tauri-drag-region>
              {project.name}
              {!empty && <span className="chat-project-sep"> / </span>}
            </span>
          )}
          {empty ? "" : chat.title}
        </h1>
        {chat.costUsd > 0 && (
          <span className="chat-cost" title={t("chat.cost")} data-tauri-drag-region>
            {t("chat.costLabel", { cost: formatUsd(chat.costUsd) })}
          </span>
        )}
        <button
          type="button"
          className={`icon-button chat-side-toggle${side ? " is-active" : ""}`}
          onClick={() => showTab(side ? null : lastTab)}
          aria-pressed={Boolean(side)}
          aria-label={t("side.toggle")}
          title={t("side.toggle")}
        >
          <PanelRightIcon />
        </button>
      </header>

      {/* The scroller exists from the start, so following the first answer works too. */}
      <div className="scroller" ref={scroller} onClick={onClick}>
        <div className={`thread${opening ? " is-opening" : ""}`} ref={content}>
          {empty ? (
            <div className="hero">
              <h2 className="hero-title">{t(greeting(new Date().getHours()))}</h2>
              <p className="hero-hint">
                {/* The credit note matters before the first chat; later it would only repeat. */}
                {project ? t("chat.projectHint", { name: project.name }) : firstRun ? t("chat.heroHint") : ""}
              </p>
            </div>
          ) : (
            chat.messages.map((message, index) => {
              const view = (
                <MessageView
                  // Messages are memoized; a new key redraws them in the new language.
                  key={`${message.id}:${language}`}
                  message={message}
                  onRedo={canRedo && index >= lastQuestion ? redo : undefined}
                  onPermission={index === ownLast ? answer : undefined}
                  projectDir={chat.projectDir}
                  onImplement={index === ownLast && !streaming ? implement : undefined}
                  onBranch={branch}
                  onRevert={chat.projectDir ? revert : undefined}
                  showModel={Boolean(message.lane || chat.messages[index + 1]?.lane)}
                  onFollowUp={streaming ? undefined : followUp}
                  onArtifact={openArtifact}
                />
              );
              // A second model's answer stands next to the chat's own.
              if (message.lane) return null;
              const rival = chat.messages[index + 1];
              if (!rival?.lane) return view;
              // Once both are done, the quicker one is marked.
              const both = message.durationMs !== undefined && rival.durationMs !== undefined && !message.streaming && !rival.streaming;
              // Only a real difference counts: half a second and five percent.
              const gap = both ? rival.durationMs! - message.durationMs! : 0;
              const clear = Math.abs(gap) > Math.max(500, 0.05 * Math.max(message.durationMs ?? 0, rival.durationMs ?? 0));
              const ownFaster = clear && gap > 0;
              const rivalFaster = clear && gap < 0;
              // Both made an artifact: the chat's own card offers them side by side.
              const comparable = Boolean(message.artifacts?.length && rival.artifacts?.length && !message.streaming && !rival.streaming);
              // Folded until the reader opens the pair: the artifacts lead, the text waits.
              const open = openPairs.has(message.id);
              return (
                <div key={`pair:${message.id}:${language}`} className={`compare-row${open ? " is-open" : ""}`}>
                  {cloneElement(view, { fastest: ownFaster, onCompareArtifacts: comparable ? compareArtifacts : undefined, collapsed: !open })}
                  <div className="compare-lane">
                    <MessageView
                      key={`${rival.id}:${language}`}
                      message={rival}
                      // Its files are in its own working copy of the project.
                      projectDir={rival.laneDir ?? chat.projectDir}
                      onPermission={answerLane}
                      onBranch={branch}
                      onArtifact={openArtifact}
                      fastest={rivalFaster}
                      tie={both && !clear}
                      collapsed={!open}
                      showModel
                    />
                    {chat.projectDir && <WorkcopyBar chatId={chat.id} message={rival} />}
                  </div>
                  <button
                    type="button"
                    className="compare-fold"
                    aria-expanded={open}
                    onClick={() => togglePair(message.id)}
                  >
                    <ChevronDownIcon size={14} />
                    {t(open ? "compare.fold" : "compare.unfold")}
                  </button>
                </div>
              );
            })
          )}
          {chat.compacting && (
            <div className="note is-active" role="status">
              <span>{t("note.compacting")}</span>
            </div>
          )}
        </div>
      </div>
      <div className="dock">{composer}</div>

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-card">{t("chat.drop")}</div>
        </div>
      )}
    </main>
    {compareSides?.[0] && compareSides[1] && (
      <ArtifactCompare
        key={`${comparing!.own}:${comparing!.lane}`}
        sides={[compareSides[0], compareSides[1]]}
        onClose={closeCompare}
      />
    )}
    {side && (
      <SidePanel
        chat={chat}
        tab={side}
        onTab={showTab}
        onClose={() => showTab(null)}
        onOpenArtifact={openArtifact}
        onImplement={canImplement ? implement : undefined}
        covered={Boolean(compareSides?.[0] && compareSides[1])}
        artifact={
          shown && shownVersions.length > 0 ? (
            <ArtifactPanel
              key={`${shown.lane ? "lane:" : ""}${shown.id}`}
              versions={shownVersions}
              version={shown.version}
              onVersion={(version) => setShown({ ...shown, version: version === shownVersions.length - 1 ? null : version })}
              onClose={() => setShown(null)}
              embedded
            />
          ) : null
        }
      />
    )}
    </div>
  );
}
