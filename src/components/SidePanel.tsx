import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { api, MODELS, type Artifact, type Chat, type Message, type PermissionMode, type ToolUse } from "../api";
import { diffLines, diffStats } from "../diff";
import { t, type TextKey } from "../i18n";
import { BrowserView, useBrowserOpen } from "./BrowserView";
import { ResizeHandle, useStoredWidth } from "./ResizeHandle";
import { DiffView } from "./DiffView";
import { ArtifactIcon, ChevronRightIcon, CloseIcon, DiffIcon, DocumentIcon, GlobeIcon, PlanIcon } from "./icons";
import { Markdown } from "./MessageView";

export type SideTab = "artifacts" | "changes" | "plan" | "browser";

const TABS: { id: SideTab; label: TextKey; icon: ReactNode; project?: boolean }[] = [
  { id: "artifacts", label: "side.artifacts", icon: <ArtifactIcon size={16} /> },
  { id: "changes", label: "side.changes", icon: <DiffIcon size={16} />, project: true },
  { id: "plan", label: "side.plan", icon: <PlanIcon size={16} />, project: true },
  { id: "browser", label: "side.browser", icon: <GlobeIcon size={16} /> },
];

const KINDS: Record<Artifact["kind"], TextKey> = {
  html: "artifact.html",
  svg: "artifact.svg",
  markdown: "artifact.markdown",
  code: "artifact.code",
};

function modelName(chat: Chat, message: Message): string {
  const id = message.model ?? chat.model;
  return MODELS.find((entry) => entry.id === id)?.name ?? id;
}

/** Every artifact of the chat once, newest first; a second model's apart from the chat's own. */
interface ArtifactEntry {
  id: string;
  lane: boolean;
  latest: Artifact;
  versions: number;
  model: string | null;
}

export function artifactEntries(chat: Chat): ArtifactEntry[] {
  const entries = new Map<string, ArtifactEntry>();
  const compared = chat.messages.some((message) => message.lane);
  for (const message of chat.messages) {
    for (const artifact of message.artifacts ?? []) {
      const lane = Boolean(message.lane);
      const key = `${lane ? "lane" : "own"}:${artifact.id}`;
      const known = entries.get(key);
      // A new version moves the artifact to the top.
      if (known) entries.delete(key);
      entries.set(key, {
        id: artifact.id,
        lane,
        latest: artifact,
        versions: (known?.versions ?? 0) + 1,
        model: compared ? modelName(chat, message) : null,
      });
    }
  }
  return [...entries.values()].reverse();
}

/** One file's changes in the chat, in order; Edit only knows the part it replaced. */
interface FileEntry {
  key: string;
  path: string;
  steps: { tool: ToolUse; reverted: boolean }[];
  added: number;
  removed: number;
  created: boolean;
  /** Every change to it was undone. */
  reverted: boolean;
}

interface ChangeGroup {
  key: string;
  /** The chat's own changes have no title; a second model's carry its name. */
  title: string | null;
  files: FileEntry[];
  /** The working copy's changes were taken over or discarded. */
  done?: "applied" | "discarded";
}

export function changeGroups(chat: Chat): ChangeGroup[] {
  const groups = new Map<string, ChangeGroup>();
  for (const message of chat.messages) {
    if (message.role !== "assistant") continue;
    const lane = Boolean(message.lane);
    // Each compared answer has its own working copy, taken over or discarded on its own.
    const groupKey = lane ? `lane:${message.id}` : "own";
    for (const tool of message.tools ?? []) {
      if (!tool.change || tool.denied || tool.failed || !tool.detail) continue;
      let group = groups.get(groupKey);
      if (!group) {
        group = { key: groupKey, title: lane ? modelName(chat, message) : null, files: [] };
        groups.set(groupKey, group);
      }
      if (lane) group.done = message.laneDone;
      let file = group.files.find((entry) => entry.path === tool.detail);
      if (!file) {
        file = { key: `${groupKey}:${tool.detail}`, path: tool.detail, steps: [], added: 0, removed: 0, created: false, reverted: true };
        group.files.push(file);
      }
      const reverted = Boolean(message.reverted);
      file.steps.push({ tool, reverted });
      file.created ||= Boolean(tool.change.created);
      file.reverted &&= reverted;
      if (!reverted) {
        const stats = diffStats(diffLines(tool.change.before, tool.change.after));
        file.added += stats.added;
        file.removed += stats.removed;
      }
    }
  }
  // The chat's own changes come first.
  return [...groups.entries()].sort(([a], [b]) => (a === "own" ? -1 : b === "own" ? 1 : 0)).map(([, group]) => group);
}

function splitPath(path: string): { name: string; dir: string } {
  const at = path.lastIndexOf("/");
  return at < 0 ? { name: path, dir: "" } : { name: path.slice(at + 1), dir: path.slice(0, at) };
}

function Stats({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="change-stats">
      {added > 0 && <span className="is-add">+{added}</span>}
      {removed > 0 && <span className="is-remove">−{removed}</span>}
    </span>
  );
}

function FileRow({ file, projectDir }: { file: FileEntry; projectDir: string | null }) {
  const [open, setOpen] = useState(false);
  const { name, dir } = splitPath(file.path);
  return (
    <li className={`side-row-item${open ? " is-open" : ""}${file.reverted ? " is-reverted" : ""}`}>
      <button type="button" className="side-row change-row" aria-expanded={open} onClick={() => setOpen(!open)} title={file.path}>
        <DocumentIcon size={15} className="side-row-icon" />
        <span className="change-name">{name}</span>
        {dir && <span className="change-dir">{dir}</span>}
        <span className="side-row-end">
          {file.created && <span className="side-tag">{t("side.created")}</span>}
          {file.reverted ? <span className="side-tag">{t("revert.label")}</span> : <Stats added={file.added} removed={file.removed} />}
          <ChevronRightIcon size={12} className="side-chevron" />
        </span>
      </button>
      {open && (
        <div className="change-steps">
          {file.steps.map(({ tool, reverted }, index) => (
            <div key={tool.id ?? index} className={`change-step${reverted ? " is-reverted" : ""}`}>
              {file.steps.length > 1 && (
                <div className="change-step-head">
                  {t(tool.name === "Write" ? "side.written" : "side.edited", { n: index + 1 })}
                  {reverted && <span className="side-tag">{t("revert.label")}</span>}
                </div>
              )}
              <DiffView before={tool.change!.before} after={tool.change!.after} numbered={tool.name === "Write"} />
            </div>
          ))}
          {projectDir && (
            <button type="button" className="text-button change-open" onClick={() => void api.projectOpenFile(projectDir, file.path).catch(() => {})}>
              {t("side.openFile")}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function Empty({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="side-empty">
      <span className="side-empty-icon">{icon}</span>
      <p>{text}</p>
    </div>
  );
}

/** A framed group, as Claude Code's panel shows its sections. */
function Group({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="side-group">
      <header className="side-group-head">
        <h3>{title}</h3>
        {meta && <span className="side-group-meta">{meta}</span>}
      </header>
      {children}
    </section>
  );
}

function Changes({ chat }: { chat: Chat }) {
  const groups = useMemo(() => changeGroups(chat), [chat.messages]);
  if (!groups.length) return <Empty icon={<DiffIcon size={20} />} text={t(chat.projectDir ? "side.noChanges" : "side.noProject")} />;
  return (
    <div className="side-scroll">
      {groups.map((group) => {
        const live = group.files.filter((file) => !file.reverted);
        const added = live.reduce((sum, file) => sum + file.added, 0);
        const removed = live.reduce((sum, file) => sum + file.removed, 0);
        return (
          <Group
            key={group.key}
            title={
              <>
                {group.title ? t("side.changesOf", { model: group.title }) : t("side.changesOwn")}
                {group.done && <span className="side-tag">{t(group.done === "applied" ? "side.applied" : "side.discarded")}</span>}
              </>
            }
            meta={
              <>
                {t(group.files.length === 1 ? "side.files.one" : "side.files.other", { n: group.files.length })}
                <Stats added={added} removed={removed} />
              </>
            }
          >
            <ul className="side-rows">
              {group.files.map((file) => (
                // A second model's files are in its working copy, which may be gone.
                <FileRow key={file.key} file={file} projectDir={group.title ? null : (chat.projectDir ?? null)} />
              ))}
            </ul>
          </Group>
        );
      })}
    </div>
  );
}

function Artifacts({ chat, onOpen }: { chat: Chat; onOpen: (id: string, artifact: Artifact) => void }) {
  const entries = useMemo(() => artifactEntries(chat), [chat.messages]);
  if (!entries.length) return <Empty icon={<ArtifactIcon size={20} />} text={t("side.noArtifacts")} />;
  // Compared models each get their group, so two artifacts of the same name stay apart.
  const groups = new Map<string, ArtifactEntry[]>();
  for (const entry of entries) {
    const key = entry.model ?? "";
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return (
    <div className="side-scroll">
      {[...groups.entries()].map(([model, list]) => (
        <Group key={model} title={model || t("side.inChat")} meta={list.length > 1 ? String(list.length) : undefined}>
          <ul className="side-rows">
            {list.map((entry) => {
              const kind = entry.latest.kind === "code" && entry.latest.language ? entry.latest.language : t(KINDS[entry.latest.kind]);
              return (
                <li key={`${entry.lane ? "lane" : "own"}:${entry.id}`} className="side-row-item">
                  <button type="button" className="side-row artifact-row" onClick={() => onOpen(entry.id, entry.latest)}>
                    <span className="artifact-row-icon">
                      <ArtifactIcon size={15} />
                    </span>
                    <span className="artifact-row-text">
                      <span className="artifact-row-title">{entry.latest.title}</span>
                      <span className="artifact-row-meta">
                        {[kind, entry.versions > 1 ? t("side.versions", { n: entry.versions }) : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <ChevronRightIcon size={12} className="side-chevron" />
                  </button>
                </li>
              );
            })}
          </ul>
        </Group>
      ))}
    </div>
  );
}

function Plan({ chat, onImplement }: { chat: Chat; onImplement?: (mode: PermissionMode) => void }) {
  const plan = [...chat.messages].reverse().find((message) => message.plan && !message.lane && message.text && !message.error);
  if (!plan) return <Empty icon={<PlanIcon size={20} />} text={t(chat.projectDir ? "side.noPlan" : "side.noProjectPlan")} />;
  return (
    <div className="side-scroll">
      <Group title={t("side.planTitle")}>
        <div className="side-plan">
          <Markdown text={plan.text} final={!plan.streaming} />
          {onImplement && !plan.streaming && (
            <div className="plan-actions">
              <button type="button" className="primary-button" onClick={() => onImplement("auto")}>
                {t("plan.implement")}
              </button>
              <button type="button" className="secondary-button" onClick={() => onImplement("default")}>
                {t("plan.implementManual")}
              </button>
            </div>
          )}
        </div>
      </Group>
    </div>
  );
}

interface Props {
  chat: Chat;
  tab: SideTab;
  onTab: (tab: SideTab) => void;
  onClose: () => void;
  /** The artifact open in the panel, drawn by the chat (it owns the versions). */
  artifact: ReactNode;
  onOpenArtifact: (id: string, artifact: Artifact) => void;
  /** Set while the last plan can be carried out. */
  onImplement?: (mode: PermissionMode) => void;
  /** Something lies over the panel, such as the artifact comparison. */
  covered: boolean;
}

/**
 * The chat's side panel, as in Claude Code: its artifacts, the changes it made
 * to files, its plan and a browser, one tab at a time. The active tab names
 * itself; the others are icons with a count.
 */
export function SidePanel({ chat, tab, onTab, onClose, artifact, onOpenArtifact, onImplement, covered }: Props) {
  const counts: Partial<Record<SideTab, number>> = {
    artifacts: useMemo(() => artifactEntries(chat).length, [chat.messages]),
    changes: useMemo(() => changeGroups(chat).reduce((sum, group) => sum + group.files.length, 0), [chat.messages]),
  };
  const browsing = useBrowserOpen();
  const wide = (tab === "artifacts" && Boolean(artifact)) || (tab === "browser" && browsing);
  const tabs = useRef<HTMLDivElement>(null);
  // Dragged widths, one for lists and one for an artifact or a page.
  const panel = useRef<HTMLElement>(null);
  const [narrowWidth, setNarrowWidth] = useStoredWidth("side");
  const [wideWidth, setWideWidth] = useStoredWidth("side.wide");
  const width = wide ? wideWidth : narrowWidth;
  const setWidth = wide ? setWideWidth : setNarrowWidth;

  // Arrow keys move between the tabs, as in any tab list.
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const at = TABS.findIndex((entry) => entry.id === tab);
    const next = TABS[(at + step + TABS.length) % TABS.length];
    onTab(next.id);
    requestAnimationFrame(() => tabs.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus());
  };

  return (
    <aside
      ref={panel}
      className={`side-panel${wide ? " is-wide" : ""}`}
      style={width ? { flexBasis: width } : undefined}
      aria-label={t("side.label")}
    >
      <ResizeHandle
        edge="left"
        label={t("resize.side")}
        measure={() => panel.current?.getBoundingClientRect().width ?? 380}
        min={wide ? 340 : 260}
        // The chat keeps room for its column.
        max={() => (panel.current?.parentElement?.clientWidth ?? 1200) - 380}
        onWidth={setWidth}
        onReset={() => setWidth(null)}
      />
      <header className="side-head" data-tauri-drag-region>
        <div className="side-tabs" role="tablist" aria-label={t("side.label")} ref={tabs} onKeyDown={onTabKey}>
          {TABS.map((entry) => {
            const active = tab === entry.id;
            const count = counts[entry.id];
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                className={`side-tab${active ? " is-active" : ""}${entry.project && !chat.projectDir ? " is-idle" : ""}`}
                onClick={() => onTab(entry.id)}
                aria-label={t(entry.label)}
                title={t(entry.label)}
              >
                {entry.icon}
                {active && <span className="side-tab-label">{t(entry.label)}</span>}
                {count ? <span className="side-tab-count">{count}</span> : null}
              </button>
            );
          })}
        </div>
        <button type="button" className="icon-button side-close" onClick={onClose} aria-label={t("side.close")} title={t("side.close")}>
          <CloseIcon size={16} />
        </button>
      </header>
      <div className="side-body" role="tabpanel">
        {tab === "artifacts" && (artifact ?? <Artifacts chat={chat} onOpen={onOpenArtifact} />)}
        {tab === "changes" && <Changes chat={chat} />}
        {tab === "plan" && <Plan chat={chat} onImplement={onImplement} />}
        {tab === "browser" && <BrowserView covered={covered} />}
      </div>
    </aside>
  );
}
