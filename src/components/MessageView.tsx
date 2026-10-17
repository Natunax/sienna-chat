import { Fragment, memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  api,
  formatUsd,
  MODELS,
  type Message,
  type PermissionDecision,
  type PermissionMode,
  type PermissionRequest,
  type ToolUse,
  type Artifact,
  type Steer,
} from "../api";
import { locale, storedErrorText, t, type TextKey } from "../i18n";
import { loadHighlighter, renderBlocks } from "../markdown";
import { mentionPath, splitMentions } from "../mentions";
import { shortTokens } from "./ContextMeter";
import { DiffView } from "./DiffView";
import {
  AlertIcon,
  AgentsIcon,
  ArtifactIcon,
  CompareIcon,
  ClockIcon,
  BranchIcon,
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  DocumentIcon,
  GlobeIcon,
  ImageIcon,
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
  mcp__sienna__artifact_view: "tool.artifactView",
  Agent: "tool.agent",
  Task: "tool.agent",
};

function ToolIcon({ name }: { name: string }) {
  if (name.startsWith("Web")) return <GlobeIcon size={13} />;
  if (name === "Bash") return <TerminalIcon size={13} />;
  if (name === "Edit") return <PencilIcon size={13} />;
  if (name === "Write") return <DocumentIcon size={13} />;
  if (name === "Check") return <ShieldCheckIcon size={13} />;
  if (name === "mcp__sienna__artifact_view") return <ArtifactIcon size={13} />;
  if (name === "Agent" || name === "Task") return <AgentsIcon size={13} />;
  return <SearchIcon size={13} />;
}

const FILE_TOOLS = ["Read", "Edit", "Write"];
/** Tools that only look around; several in a row fold into one line, as in Claude Code. */
const QUIET_TOOLS = ["Read", "Grep", "Glob", "Bash", "WebSearch", "WebFetch", "mcp__sienna__artifact_view", "Agent", "Task"];

type ToolGroup = { quiet: boolean; items: { tool: ToolUse; index: number }[] };

function groupTools(tools: ToolUse[]): ToolGroup[] {
  const groups: ToolGroup[] = [];
  tools.forEach((tool, index) => {
    // A declined or failed step stays in view.
    const quiet = QUIET_TOOLS.includes(tool.name) && !tool.denied;
    const last = groups[groups.length - 1];
    if (quiet && last?.quiet) last.items.push({ tool, index });
    else groups.push({ quiet, items: [{ tool, index }] });
  });
  // A single quiet step needs no fold.
  return groups.flatMap((group) =>
    group.quiet && group.items.length < 2 ? [{ ...group, quiet: false }] : [group],
  );
}

/** "Ran 4 commands, read 2 files, searched 3 times". */
function toolSummary(tools: ToolUse[]): string {
  const count = (names: string[]) => tools.filter((tool) => names.includes(tool.name)).length;
  const parts: [number, TextKey, TextKey][] = [
    [count(["Bash"]), "tools.bash.one", "tools.bash.other"],
    [count(["Read"]), "tools.read.one", "tools.read.other"],
    [count(["Grep", "Glob"]), "tools.search.one", "tools.search.other"],
    [count(["WebSearch", "WebFetch"]), "tools.web.one", "tools.web.other"],
    [count(["mcp__sienna__artifact_view"]), "tools.view.one", "tools.view.other"],
    [count(["Agent", "Task"]), "tools.agent.one", "tools.agent.other"],
  ];
  const text = parts
    .filter(([n]) => n > 0)
    .map(([n, one, other]) => t(n === 1 ? one : other, { n }))
    .join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

interface ToolRowProps {
  tool: ToolUse;
  projectDir?: string | null;
  reverted?: boolean;
}

/** One step: what Claude did and on what; a change or output opens below it. */
function ToolRow({ tool, projectDir, reverted }: ToolRowProps) {
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState(false);
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
    <>
      <div className={`tool-chip${state}${open ? " is-open" : ""}`}>
        {expandable ? (
          <button type="button" className="tool-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
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
                .then(() => setMissing(false))
                .catch(() => setMissing(true))
            }
          >
            {tool.detail}
          </button>
        ) : (
          tool.detail && (
            <span className="tool-detail" title={tool.detail}>
              {tool.detail}
            </span>
          )
        )}
        {tool.denied && <span className="tool-state">{t("tool.denied")}</span>}
        {reverted && tool.change && !tool.denied && <span className="tool-state">{t("revert.label")}</span>}
        {!tool.denied && tool.failed && <span className="tool-state">{t("tool.failed")}</span>}
        {missing && <span className="tool-state is-error">{t("error.fileMissing")}</span>}
      </div>
      {open && tool.change && (
        <div className="tool-panel">
          <DiffView before={tool.change.before} after={tool.change.after} numbered={tool.name === "Write"} />
        </div>
      )}
      {open && !tool.change && tool.output !== undefined && (
        <pre className="tool-panel tool-output">
          {/* The row cuts a long command; here it shows in full. */}
          {tool.name === "Bash" && tool.detail && <code className="tool-command">$ {tool.detail}</code>}
          <code>{tool.output || t("tool.noOutput")}</code>
        </pre>
      )}
    </>
  );
}

/** Several steps that only looked around, folded into one line until opened. */
function ToolFold({ group, active, ...row }: { group: ToolGroup; active: boolean } & Omit<ToolRowProps, "tool">) {
  const [open, setOpen] = useState(false);
  const tools = group.items.map((item) => item.tool);
  const failed = tools.filter((tool) => tool.failed).length;
  // While the answer runs, the step under way shows next to the count.
  const current = active ? tools[tools.length - 1] : null;
  return (
    <div className={`tool-fold${open ? " is-open" : ""}`}>
      <button type="button" className="tool-fold-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="tool-fold-summary">{toolSummary(tools)}</span>
        {failed > 0 && <span className="tool-state is-error">{t("tools.failed", { n: failed })}</span>}
        {current && !open && <span className="tool-detail">{current.detail}</span>}
        <ChevronRightIcon size={12} className="tool-chevron" />
      </button>
      {open && (
        <div className="tool-fold-body">
          {group.items.map(({ tool, index }) => (
            <ToolRow key={index} tool={tool} {...row} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The tools an answer used; changes and command output open below the row, files in the editor. */
function Tools({
  tools,
  active,
  ...row
}: { tools: ToolUse[]; active: boolean } & Omit<ToolRowProps, "tool">) {
  const groups = groupTools(tools);
  return (
    <div className="tools">
      {groups.map((group, at) =>
        group.quiet ? (
          <ToolFold key={group.items[0].index} group={group} active={active && at === groups.length - 1} {...row} />
        ) : (
          group.items.map(({ tool, index }) => <ToolRow key={index} tool={tool} {...row} />)
        ),
      )}
    </div>
  );
}

type FlowItem =
  | { kind: "text"; key: string; text: string }
  | { kind: "tools"; key: string; tools: ToolUse[] }
  | { kind: "artifact"; key: string; artifact: Artifact }
  | { kind: "steer"; key: string; steer: Steer };

/**
 * An answer in the order it happened: text, then the steps it took, then more
 * text, with artifacts and messages sent in between where they came. Steps of
 * older chats know no place and come first, as they used to.
 */
function flowOf(message: Message): FlowItem[] {
  type Event = { at: number; step: number; item: FlowItem; tool?: ToolUse };
  const events: Event[] = [
    ...(message.tools ?? []).map((tool, index) => ({
      at: tool.textAt ?? 0,
      step: tool.step ?? index,
      tool,
      item: { kind: "tools" as const, key: `g${index}`, tools: [tool] },
    })),
    ...(message.artifacts ?? []).map((artifact, index) => ({
      at: artifact.textAt ?? 0,
      step: artifact.step ?? 10_000 + index,
      item: { kind: "artifact" as const, key: `a${index}`, artifact },
    })),
    ...(message.steers ?? []).map((steer) => ({
      at: steer.textAt,
      step: steer.step,
      item: { kind: "steer" as const, key: `s${steer.id}`, steer },
    })),
  ].sort((a, b) => a.at - b.at || a.step - b.step);
  const items: FlowItem[] = [];
  let cursor = 0;
  const text = message.text;
  for (const event of events) {
    const at = Math.min(event.at, text.length);
    if (at > cursor) {
      if (text.slice(cursor, at).trim()) items.push({ kind: "text", key: `t${cursor}`, text: text.slice(cursor, at) });
      cursor = at;
    }
    const last = items[items.length - 1];
    // Steps in a row stay one group, so looking around still folds into one line.
    if (event.tool && last?.kind === "tools") last.tools.push(event.tool);
    else items.push(event.item.kind === "tools" ? { ...event.item, tools: [...event.item.tools] } : event.item);
  }
  if (text.slice(cursor).trim()) items.push({ kind: "text", key: `t${cursor}`, text: text.slice(cursor) });
  return items;
}

/** A message the user sent into the running answer, where it went in. */
function SteerNote({ steer }: { steer: Steer }) {
  return (
    <div className={`msg-steer${steer.taken ? " is-taken" : ""}`}>
      <span className="msg-steer-label">{t(steer.taken ? "steer.taken" : "steer.waiting")}</span>
      <p className="msg-steer-text">{steer.text}</p>
    </div>
  );
}

const ARTIFACT_KINDS: Record<Artifact["kind"], TextKey> = {
  html: "artifact.html",
  svg: "artifact.svg",
  markdown: "artifact.markdown",
  code: "artifact.code",
};

/** An artifact in the answer: a card that opens it next to the chat. */
function ArtifactCard({ artifact, onOpen }: { artifact: Artifact; onOpen?: () => void }) {
  const kind = artifact.kind === "code" && artifact.language ? artifact.language : t(ARTIFACT_KINDS[artifact.kind]);
  return (
    <button type="button" className="artifact-card" onClick={onOpen} disabled={!onOpen}>
      <span className="artifact-card-icon">
        <ArtifactIcon size={18} />
      </span>
      <span className="artifact-card-text">
        <span className="artifact-card-title">{artifact.title}</span>
        <span className="artifact-card-kind">{kind}</span>
      </span>
      {onOpen && <span className="artifact-card-open">{t("artifact.open")}</span>}
    </button>
  );
}

/**
 * A file sent with a question: an image or a document icon, and the name cut
 * in its middle so the extension stays readable.
 */
function FileChip({ name, mediaType }: { name: string; mediaType: string }) {
  const dot = name.lastIndexOf(".");
  // The last few characters before the extension stay too: "…14.24.37.png".
  const tail = dot > 0 ? Math.max(0, dot - 6) : name.length;
  return (
    <span className="file-chip" title={name}>
      {mediaType.startsWith("image/") ? <ImageIcon size={14} /> : <DocumentIcon size={14} />}
      <span className="file-chip-name">
        <span className="file-chip-start">{name.slice(0, tail)}</span>
        <span className="file-chip-end">{name.slice(tail)}</span>
      </span>
    </span>
  );
}

/** A question with its `@` mentions set apart; a mentioned file opens in the editor. */
function MentionText({ text, projectDir }: { text: string; projectDir: string }) {
  return (
    <>
      {splitMentions(text).map((part, index) => {
        if (!part.mention) return part.text;
        const path = mentionPath(part.text);
        // "@Claude" is a name, not a path.
        if (!/[./]/.test(path)) return part.text;
        if (path.endsWith("/")) {
          return (
            <span key={index} className="bubble-mention">
              {part.text}
            </span>
          );
        }
        return (
          <button
            key={index}
            type="button"
            className="bubble-mention"
            title={t("mention.open", { path })}
            onClick={() => void api.projectOpenFile(projectDir, path).catch(() => {})}
          >
            {part.text}
          </button>
        );
      })}
    </>
  );
}

export function Markdown({ text, final }: { text: string; final: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const blocks = useMemo(() => renderBlocks(text, final), [text, final]);

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

/** "4,2 s", "42 s" or "1:05 min". */
export function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
  if (seconds < 60) return `${Math.floor(seconds)} s`;
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")} min`;
}

/** How long an answer has been running, ticking, or how long it took. */
function Elapsed({ message, className }: { message: Message; className: string }) {
  const [now, setNow] = useState(Date.now());
  const running = Boolean(message.streaming && message.startedAt);
  useEffect(() => {
    if (!running) return;
    // Tenths for the first ten seconds, then whole seconds: tick only when the text changes.
    let timer = 0;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const elapsed = current - message.startedAt!;
      timer = window.setTimeout(tick, elapsed < 10_000 ? 100 : 1000 - (elapsed % 1000));
    };
    tick();
    return () => clearTimeout(timer);
  }, [running, message.startedAt]);
  const ms = running ? now - message.startedAt! : message.durationMs;
  if (ms === undefined) return null;
  return (
    <span className={`${className}${running ? " is-running" : ""}`} title={t(running ? "timer.running" : "timer.took")}>
      <ClockIcon size={12} />
      {formatDuration(ms)}
    </span>
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

export function CopyButton({ text }: { text: string }) {
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
      <span className="sr-only" role="status">
        {copied ? t("message.copied") : ""}
      </span>
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
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
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
  /** Also names the answer, so one stable callback serves every compared answer. */
  onPermission?: (request: PermissionRequest, decision: PermissionDecision, messageId: string) => void;
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
  /** Sends a task or finding of a template answer as the next message. */
  onFollowUp?: (text: string) => void;
  /** Opens an artifact of this answer next to the chat. */
  onArtifact?: (id: string, version: Artifact) => void;
  /** Compared with another model, this answer was the quicker one. */
  fastest?: boolean;
  /** Both compared answers took about as long. */
  tie?: boolean;
  /** Both compared answers made an artifact: open them side by side. */
  onCompareArtifacts?: (messageId: string) => void;
  /** Compared side by side and folded: artifacts and approvals show, the text only begins. */
  collapsed?: boolean;
}

/** The start of a folded answer; it fades out only when there is more below. */
function Fold({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setClipped(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={`msg-fold${clipped ? " is-clipped" : ""}`} aria-hidden="true">
      {children}
    </div>
  );
}

function MessageViewImpl({
  message,
  onRedo,
  onPermission,
  projectDir,
  onImplement,
  onBranch,
  onRevert,
  showModel,
  onFollowUp,
  onArtifact,
  fastest,
  tie,
  onCompareArtifacts,
  collapsed,
}: Props) {
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
              <FileChip key={index} name={file.name} mediaType={file.mediaType} />
            ))}
          </div>
        ) : null}
        {message.text && (
          <div className="bubble">{projectDir ? <MentionText text={message.text} projectDir={projectDir} /> : message.text}</div>
        )}
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
    !streaming && onRevert && !message.lane && !message.reverted && message.checkpoint && message.tools?.some((tool) => tool.change);
  const modelName = MODELS.find((entry) => entry.id === message.model)?.name;
  const flow = flowOf(message);
  const lastArtifact = message.artifacts?.at(-1);
  const compareLink =
    onCompareArtifacts && message.artifacts?.length ? (
      <button type="button" className="artifact-compare-link" onClick={() => onCompareArtifacts(message.id)}>
        <CompareIcon size={14} />
        {t("compareArtifacts.open")}
      </button>
    ) : null;
  return (
    <div className={`msg msg-assistant${message.lane ? " is-lane" : ""}`} aria-busy={streaming}>
      {/* Compared side by side: the model and its time, so both read at a glance. */}
      {showModel && modelName && (
        <div className={`msg-model${fastest ? " is-fastest" : ""}`}>
          <span>{modelName}</span>
          <Elapsed message={message} className="msg-time" />
          {fastest && <span className="msg-fastest">{t("timer.fastest")}</span>}
          {tie && <span className="msg-tie">{t("timer.tie")}</span>}
        </div>
      )}
      {/* Folded, only the sign that it is still at work shows. */}
      {(collapsed ? waiting && !message.text : message.thinking || waiting) && <Thinking text={message.thinking ?? ""} active={waiting} />}
      {collapsed || message.format ? (
        <>
          {/* Folded or a template's data: steps first, the rest as a whole. */}
          {!collapsed && message.tools?.length ? <Tools tools={message.tools} active={streaming} projectDir={projectDir} reverted={message.reverted} /> : null}
          {message.artifacts?.map((artifact, index) => (
            <ArtifactCard key={index} artifact={artifact} onOpen={onArtifact ? () => onArtifact(artifact.id, artifact) : undefined} />
          ))}
          {compareLink}
          {collapsed
            ? message.text &&
              !message.format && (
                <Fold>
                  <Markdown text={message.text} final={!streaming} />
                </Fold>
              )
            : structured && message.format
              ? <StructuredView format={message.format} data={structured} onFollowUp={onFollowUp} />
              : message.text && !streaming && <Markdown text={message.text} final />}
        </>
      ) : (
        flow.map((item, index) => {
          const last = index === flow.length - 1;
          if (item.kind === "text") return <Markdown key={item.key} text={item.text} final={!streaming || !last} />;
          if (item.kind === "tools") {
            return <Tools key={item.key} tools={item.tools} active={streaming && last} projectDir={projectDir} reverted={message.reverted} />;
          }
          if (item.kind === "steer") return <SteerNote key={item.key} steer={item.steer} />;
          const { artifact } = item;
          return (
            <Fragment key={item.key}>
              <ArtifactCard artifact={artifact} onOpen={onArtifact ? () => onArtifact(artifact.id, artifact) : undefined} />
              {/* Right under the last artifact, so a long answer does not hide it. */}
              {artifact === lastArtifact && compareLink}
            </Fragment>
          );
        })
      )}
      {!collapsed && streaming && flow.at(-1)?.kind === "text" && !message.format && !message.permissions?.length && (
        <span className="caret" aria-hidden="true" />
      )}
      {onPermission &&
        message.permissions?.map((request) => (
          <PermissionCard key={request.id} request={request} onAnswer={(answer, decision) => onPermission(answer, decision, message.id)} />
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
      {/* The stopwatch while the answer runs; compared answers show it in their header. */}
      {streaming && !showModel && message.startedAt && (
        <div className="msg-live">
          <Elapsed message={message} className="msg-time" />
        </div>
      )}
      {!collapsed && !streaming && (message.text || onRedo || structured) ? (
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
          {!showModel && <Elapsed message={message} className="msg-cost msg-duration" />}
          {message.costUsd ? <span className="msg-cost">{formatUsd(message.costUsd)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export const MessageView = memo(MessageViewImpl);
