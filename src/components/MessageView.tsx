import { memo, useEffect, useMemo, useRef, useState } from "react";
import { formatUsd, type Message } from "../api";
import { loadHighlighter, renderBlocks } from "../markdown";
import { AlertIcon, ChevronRightIcon, DocumentIcon, GlobeIcon, SparkIcon } from "./icons";

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

function MessageViewImpl({ message }: { message: Message }) {
  if (message.role === "user") {
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
      {!streaming && !message.error && message.costUsd ? (
        <div className="msg-meta">{formatUsd(message.costUsd)}</div>
      ) : null}
    </div>
  );
}

export const MessageView = memo(MessageViewImpl);
