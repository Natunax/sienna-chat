import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { formatUsd, type Chat, type OutgoingAttachment } from "../api";
import { t, useLanguage } from "../i18n";
import { redoLast, rewindPoint, sendMessage, stopMessage, updateChat } from "../store";
import { Composer, type ComposerSettings } from "./Composer";
import { SidebarIcon } from "./icons";
import { MessageView } from "./MessageView";

interface Props {
  chat: Chat;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onSettingsChange: (settings: ComposerSettings) => void;
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

export function ChatView({ chat, sidebarOpen, onToggleSidebar, onSettingsChange }: Props) {
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<File[]>([]);
  const { scroller, content, stuck } = useStickToBottom(chat.id);
  const last = chat.messages[chat.messages.length - 1];
  const streaming = Boolean(last?.streaming);
  const empty = chat.messages.length === 0;
  const language = useLanguage();

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
      onProject={(projectDir) => updateChat(chat.id, (current) => ({ ...current, projectDir }))}
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
          {empty ? "" : chat.title}
        </h1>
        {chat.costUsd > 0 && (
          <span className="chat-cost" title={t("chat.cost")} data-tauri-drag-region>
            {formatUsd(chat.costUsd)}
          </span>
        )}
      </header>

      {empty ? (
        <div className="hero">
          <div className="hero-inner">
            <h2 className="hero-title">{t("chat.heroTitle")}</h2>
            {composer}
            <p className="hero-hint">{t("chat.heroHint")}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="scroller" ref={scroller} onClick={onClick}>
            <div className="thread" ref={content}>
              {chat.messages.map((message, index) => (
                <MessageView
                  // Messages are memoized; a new key redraws them in the new language.
                  key={`${message.id}:${language}`}
                  message={message}
                  onRedo={canRedo && index >= lastQuestion ? redo : undefined}
                />
              ))}
            </div>
          </div>
          <div className="dock">{composer}</div>
        </>
      )}

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-card">{t("chat.drop")}</div>
        </div>
      )}
    </main>
  );
}
