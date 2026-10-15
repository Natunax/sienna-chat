import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { formatUsd, type Message } from "../api";
import { loadHighlighter, renderBlocks } from "../markdown";
import { AlertIcon, CheckIcon, ChevronRightIcon, CopyIcon, DocumentIcon, GlobeIcon, PencilIcon, RetryIcon, SparkIcon } from "./icons";

const TOOL_LABELS: Record<string, string> = {
  WebSearch: "Sucht im Web",
  WebFetch: "Liest Seite",
};

function Markdown({ text, final }: { text: string; final: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const blocks = useMemo(() => renderBlocks(text), [text]);

  useEffect(() => {
    const root = ref.current;
    if (!final || !root) return;
    const blocks = root.querySelectorAll<HTMLElement>("pre > code");
    if (!blocks.length) return;
    let cancelled = false;
    void loadHighlighter().then((hljs) => {
      if (cancelled) return;
      blocks.forEach((code) => {
        const pre = code.parentElement!;
        if (pre.dataset.enhanced) return;
        pre.dataset.enhanced = "1";
        const language = /language-([\w+-]+)/.exec(code.className)?.[1];
        if (language && hljs.getLanguage(language)) hljs.highlightElement(code);
        const bar = document.createElement("div");
        bar.className = "code-bar";
        const label = document.createElement("span");
        label.textContent = language ?? "Code";
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "code-copy";
        copy.textContent = "Kopieren";
        copy.setAttribute("aria-label", "Code kopieren");
        bar.append(label, copy);
        pre.prepend(bar);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [blocks, final]);

  // One element per block: React leaves finished blocks alone while the last
  // one grows, which also keeps a text selection in them intact.
  return (
    <div ref={ref} className="markdown">
      {blocks.map((block) => (
        <div key={block.key} className="md-block" dangerouslySetInnerHTML={{ __html: block.html }} />
      ))}
    </div>
  );
}

function Thinking({ text, active }: { text: string; active: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`thinking${open ? " is-open" : ""}`}>
      <button type="button" className="thinking-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <SparkIcon size={14} className={active ? "pulse" : undefined} />
        <span>{active ? "Denkt nach…" : "Gedankengang"}</span>
        <ChevronRightIcon size={14} className="thinking-chevron" />
      </button>
      {open && text && <div className="thinking-body">{text}</div>}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="msg-action"
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
      aria-label={copied ? "Kopiert" : "Antwort kopieren"}
      title={copied ? "Kopiert" : "Antwort kopieren"}
    >
      {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
    </button>
  );
}

function EditBox({ text, onSubmit, onCancel }: { text: string; onSubmit: (text: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(text);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [value]);

  const submit = () => value.trim() && onSubmit(value.trim());
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") onCancel();
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="edit-box">
      <textarea
        ref={area}
        className="edit-input"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Nachricht bearbeiten"
      />
      <div className="edit-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Abbrechen
        </button>
        <button type="button" className="primary-button" onClick={submit} disabled={!value.trim()}>
          Senden
        </button>
      </div>
    </div>
  );
}

interface Props {
  message: Message;
  /** Set on the last question and answer when they can be replaced. */
  onRedo?: (text?: string) => void;
}

function MessageViewImpl({ message, onRedo }: Props) {
  const [editing, setEditing] = useState(false);

  if (message.role === "user") {
    if (editing && onRedo) {
      return (
        <div className="msg msg-user">
          <EditBox
            text={message.text}
            onCancel={() => setEditing(false)}
            onSubmit={(text) => {
              setEditing(false);
              onRedo(text);
            }}
          />
        </div>
      );
    }
    return (
      <div className="msg msg-user">
        {message.attachments?.length ? (
          <div className="msg-files">
            {message.attachments.map((file, index) => (
              <span key={index} className="file-chip">
                <DocumentIcon size={14} />
                {file.name}
              </span>
            ))}
          </div>
        ) : null}
        {message.text && <div className="bubble">{message.text}</div>}
        {onRedo && (
          <div className="msg-actions">
            <button
              type="button"
              className="msg-action"
              onClick={() => setEditing(true)}
              aria-label="Nachricht bearbeiten"
              title="Nachricht bearbeiten"
            >
              <PencilIcon size={15} />
            </button>
          </div>
        )}
      </div>
    );
  }

  const streaming = Boolean(message.streaming);
  const waiting = streaming && !message.text;
  return (
    <div className="msg msg-assistant" aria-busy={streaming}>
      {(message.thinking || waiting) && <Thinking text={message.thinking ?? ""} active={waiting} />}
      {message.tools?.length ? (
        <div className="tools">
          {message.tools.map((tool, index) => (
            <span key={index} className="tool-chip">
              <GlobeIcon size={13} />
              <span className="tool-name">{TOOL_LABELS[tool.name] ?? tool.name}</span>
              {tool.detail && <span className="tool-detail">{tool.detail}</span>}
            </span>
          ))}
        </div>
      ) : null}
      {message.text && <Markdown text={message.text} final={!streaming} />}
      {streaming && message.text && <span className="caret" aria-hidden="true" />}
      {message.error && (
        <div className="msg-error" role="alert">
          <AlertIcon size={15} />
          {message.error}
        </div>
      )}
      {!streaming && (message.text || onRedo) ? (
        <div className="msg-actions">
          {message.text && <CopyButton text={message.text} />}
          {onRedo && (
            <button
              type="button"
              className="msg-action"
              onClick={() => onRedo()}
              aria-label="Antwort neu erzeugen"
              title="Antwort neu erzeugen"
            >
              <RetryIcon size={15} />
            </button>
          )}
          {message.costUsd ? <span className="msg-cost">{formatUsd(message.costUsd)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export const MessageView = memo(MessageViewImpl);
