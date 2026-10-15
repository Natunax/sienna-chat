import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  api,
  formatUsd,
  MODELS,
  type Message,
  type PermissionDecision,
  type PermissionMode,
  type PermissionRequest,
  type ToolUse,
} from "../api";
import { storedErrorText, t, type TextKey } from "../i18n";
import { loadHighlighter, renderBlocks } from "../markdown";
import { shortTokens } from "./ContextMeter";
import { DiffView } from "./DiffView";
import {
  AlertIcon,
  BranchIcon,
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  DocumentIcon,
  GlobeIcon,
  PencilIcon,
  RetryIcon,
  SearchIcon,
  SparkIcon,
  ShieldCheckIcon,
  TerminalIcon,
  UndoIcon,
} from "./icons";
import { PermissionCard } from "./PermissionCard";
import { StructuredView } from "./StructuredView";

const TOOL_LABELS: Record<string, TextKey> = {
  WebSearch: "message.searching",
  WebFetch: "message.reading",
  Read: "message.readFile",
  Grep: "message.grep",
  Glob: "message.glob",
  Edit: "tool.edit",
  Write: "tool.write",
  Bash: "tool.bash",
  Check: "tool.check",
};

function ToolIcon({ name }: { name: string }) {
  if (name.startsWith("Web")) return <GlobeIcon size={13} />;
  if (name === "Bash") return <TerminalIcon size={13} />;
  if (name === "Edit") return <PencilIcon size={13} />;
  if (name === "Write") return <DocumentIcon size={13} />;
  if (name === "Check") return <ShieldCheckIcon size={13} />;
  return <SearchIcon size={13} />;
}

const FILE_TOOLS = ["Read", "Edit", "Write"];

/** The tools an answer used; changes and command output open below the row, files in the editor. */
function Tools({ tools, projectDir, reverted }: { tools: ToolUse[]; projectDir?: string | null; reverted?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const [missing, setMissing] = useState<number | null>(null);
  const shown = open === null ? undefined : tools[open];
  return (
    <>
      <div className="tools">
        {tools.map((tool, index) => {
          const state = tool.denied ? " is-denied" : tool.failed ? " is-failed" : "";
          const expandable = Boolean(tool.change || tool.output !== undefined);
          const name = (
            <>
              <ToolIcon name={tool.name} />
              <span className="tool-name">{TOOL_LABELS[tool.name] ? t(TOOL_LABELS[tool.name]) : tool.name}</span>
            </>
          );
          // A file that was only proposed and declined may not exist.
          const openable = projectDir && FILE_TOOLS.includes(tool.name) && tool.detail && !tool.denied;
          return (
            <div key={index} className={`tool-chip${state}${open === index ? " is-open" : ""}`}>
              {expandable ? (
                <button
                  type="button"
                  className="tool-toggle"
                  aria-expanded={open === index}
                  onClick={() => setOpen(open === index ? null : index)}
                >
                  {name}
                  <ChevronRightIcon size={12} className="tool-chevron" />
                </button>
              ) : (
                <span className="tool-toggle">{name}</span>
              )}
              {openable ? (
                <button
                  type="button"
                  className="tool-detail tool-file"
                  title={t("tool.open", { path: tool.detail })}
                  onClick={() =>
                    void api
                      .projectOpenFile(projectDir, tool.detail)
                      .then(() => setMissing(null))
                      .catch(() => setMissing(index))
                  }
                >
                  {tool.detail}
                </button>
              ) : (
                tool.detail && <span className="tool-detail">{tool.detail}</span>
              )}
              {tool.denied && <span className="tool-state">{t("tool.denied")}</span>}
              {reverted && tool.change && !tool.denied && <span className="tool-state">{t("revert.label")}</span>}
              {!tool.denied && tool.failed && <span className="tool-state">{t("tool.failed")}</span>}
              {missing === index && <span className="tool-state is-error">{t("error.fileMissing")}</span>}
            </div>
          );
        })}
      </div>
      {shown?.change && (
        <div className="tool-panel">
          <DiffView before={shown.change.before} after={shown.change.after} numbered={shown.name === "Write"} />
        </div>
      )}
      {shown && !shown.change && shown.output !== undefined && (
        <pre className="tool-panel tool-output">
          <code>{shown.output || t("tool.noOutput")}</code>
        </pre>
      )}
    </>
  );
}

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
        label.textContent = language ?? t("code.fallback");
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "code-copy";
        copy.textContent = t("code.copy");
        copy.setAttribute("aria-label", t("code.copyLabel"));
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
        <span>{active ? t("message.thinking") : t("message.thoughts")}</span>
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
      aria-label={copied ? t("message.copied") : t("message.copy")}
      title={copied ? t("message.copied") : t("message.copy")}
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
        aria-label={t("message.edit")}
      />
      <div className="edit-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          {t("message.cancel")}
        </button>
        <button type="button" className="primary-button" onClick={submit} disabled={!value.trim()}>
          {t("message.send")}
        </button>
      </div>
    </div>
  );
}

interface Props {
  message: Message;
  /** Set on the last question and answer when they can be replaced. */
  onRedo?: (text?: string) => void;
  onPermission?: (request: PermissionRequest, decision: PermissionDecision) => void;
  /** The chat's project folder; file paths in the steps open from it. */
  projectDir?: string | null;
  /** Set on the last answer: carries out a plan it ends with. */
  onImplement?: (mode: PermissionMode) => void;
  /** Starts a new chat that continues from this answer. */
  onBranch?: (messageId: string) => void;
  /** Undoes the file changes from this answer on. */
  onRevert?: (messageId: string) => void;
  /** Shows the model above the answer, when two answer side by side. */
  showModel?: boolean;
}

function MessageViewImpl({ message, onRedo, onPermission, projectDir, onImplement, onBranch, onRevert, showModel }: Props) {
  const [editing, setEditing] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);
  useEffect(() => {
    if (!confirmRevert) return;
    const timer = setTimeout(() => setConfirmRevert(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmRevert]);

  if (message.role === "note") {
    const compaction = message.compaction;
    const figures =
      compaction?.before && compaction.after ? ` · ${shortTokens(compaction.before)} → ${shortTokens(compaction.after)}` : "";
    return (
      <div className={`note${message.error ? " is-error" : ""}`} role="note">
        <span>
          {message.error
            ? storedErrorText(message.error)
            : message.text
              ? t(message.text as TextKey)
              : `${t(compaction?.trigger === "auto" ? "note.compactedAuto" : "note.compactedManual")}${figures}`}
        </span>
      </div>
    );
  }

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
              aria-label={t("message.edit")}
              title={t("message.edit")}
            >
              <PencilIcon size={15} />
            </button>
          </div>
        )}
      </div>
    );
  }

  const streaming = Boolean(message.streaming);
  const structured = message.format && message.structured ? message.structured : null;
  const waiting = streaming && (!message.text || Boolean(message.format)) && !message.permissions?.length;
  const branchable = !streaming && onBranch && (message.lane ? message.laneSession && message.laneTurnEnd : message.turnEnd);
  const revertable =
    !streaming && onRevert && !message.lane && !message.reverted && message.turnEnd && message.tools?.some((tool) => tool.change);
  const modelName = MODELS.find((entry) => entry.id === message.model)?.name;
  return (
    <div className={`msg msg-assistant${message.lane ? " is-lane" : ""}`} aria-busy={streaming}>
      {showModel && modelName && <div className="msg-model">{modelName}</div>}
      {(message.thinking || waiting) && <Thinking text={message.thinking ?? ""} active={waiting} />}
      {message.tools?.length ? <Tools tools={message.tools} projectDir={projectDir} reverted={message.reverted} /> : null}
      {structured && message.format ? (
        <StructuredView format={message.format} data={structured} />
      ) : (
        message.text && !(message.format && streaming) && <Markdown text={message.text} final={!streaming} />
      )}
      {streaming && message.text && !message.format && !message.permissions?.length && (
        <span className="caret" aria-hidden="true" />
      )}
      {onPermission &&
        message.permissions?.map((request) => (
          <PermissionCard key={request.id} request={request} onAnswer={onPermission} />
        ))}
      {message.plan && !streaming && !message.error && message.text && onImplement && (
        <div className="plan-actions">
          <button type="button" className="primary-button" onClick={() => onImplement("auto")}>
            {t("plan.implement")}
          </button>
          <button type="button" className="secondary-button" onClick={() => onImplement("default")}>
            {t("plan.implementManual")}
          </button>
        </div>
      )}
      {message.error && (
        <div className="msg-error" role="alert">
          <AlertIcon size={15} />
          {storedErrorText(message.error)}
        </div>
      )}
      {!streaming && (message.text || onRedo || structured) ? (
        <div className="msg-actions">
          {message.text && !structured && <CopyButton text={message.text} />}
          {onRedo && (
            <button
              type="button"
              className="msg-action"
              onClick={() => onRedo()}
              aria-label={t("message.regenerate")}
              title={t("message.regenerate")}
            >
              <RetryIcon size={15} />
            </button>
          )}
          {branchable && (
            <button
              type="button"
              className="msg-action"
              onClick={() => onBranch(message.id)}
              aria-label={t(message.lane ? "compare.continue" : "branch.action")}
              title={t(message.lane ? "compare.continue" : "branch.action")}
            >
              <BranchIcon size={15} />
            </button>
          )}
          {revertable &&
            (confirmRevert ? (
              <button
                type="button"
                className="msg-action is-confirm"
                onClick={() => {
                  setConfirmRevert(false);
                  onRevert(message.id);
                }}
              >
                <UndoIcon size={14} />
                {t("revert.confirm")}
              </button>
            ) : (
              <button
                type="button"
                className="msg-action"
                onClick={() => setConfirmRevert(true)}
                aria-label={t("revert.action")}
                title={t("revert.action")}
              >
                <UndoIcon size={15} />
              </button>
            ))}
          {message.costUsd ? <span className="msg-cost">{formatUsd(message.costUsd)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export const MessageView = memo(MessageViewImpl);
