import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent } from "react";
import {
  DEFAULT_MODE,
  formatUsd,
  type Chat,
  type OutgoingAttachment,
  type PermissionDecision,
  type PermissionMode,
  type PermissionRequest,
} from "../api";
import { t, useLanguage, type TextKey } from "../i18n";
import {
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
} from "../store";
import { Composer, type ComposerSettings } from "./Composer";
import { SidebarIcon } from "./icons";
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
  const [dropped, setDropped] = useState<File[]>([]);
  const { scroller, content, stuck } = useStickToBottom(chat.id);
  // The last answer and a second model's next to it; while the conversation
  // is being compacted, nothing new can be sent either.
  const streaming = chat.messages.slice(-3).some((message) => message.streaming) || Boolean(chat.compacting);
  const empty = chat.messages.length === 0;
  const language = useLanguage();
  const project = projectFor(chat, useProjects());

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
      onCheck={project ? (command) => void setProjectCheck(project.id, command) : undefined}
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
            {formatUsd(chat.costUsd)}
          </span>
        )}
      </header>

      {/* The scroller exists from the start, so following the first answer works too. */}
      <div className="scroller" ref={scroller} onClick={onClick}>
        <div className="thread" ref={content}>
          {empty ? (
            <div className="hero">
              <h2 className="hero-title">{t(greeting(new Date().getHours()))}</h2>
              <p className="hero-hint">
                {project ? t("chat.projectHint", { name: project.name }) : t("chat.heroHint")}
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
                />
              );
              // A second model's answer stands next to the chat's own.
              if (message.lane) return null;
              const rival = chat.messages[index + 1];
              if (!rival?.lane) return view;
              return (
                <div key={`pair:${message.id}:${language}`} className="compare-row">
                  {view}
                  <MessageView
                    key={`${rival.id}:${language}`}
                    message={rival}
                    projectDir={chat.projectDir}
                    onBranch={branch}
                    showModel
                  />
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
  );
}
