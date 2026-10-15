import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { formatUsd, type ChatSummary, type Project, type Usage } from "../api";
import { locale, t, useLanguage } from "../i18n";
import { projectFor } from "../store";
import {
  BranchIcon,
  ChevronRightIcon,
  CloseIcon,
  ComposeIcon,
  FolderIcon,
  GearIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SidebarIcon,
  TrashIcon,
} from "./icons";

interface Props {
  summaries: ChatSummary[];
  projects: Project[];
  activeId: string | null;
  /** The project of the open chat, kept expanded. */
  activeProjectId: string | null;
  projectError: string | null;
  usage: Usage | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string) => void;
  onAddProject: () => void;
  onNewInProject: (projectId: string) => void;
  onRemoveProject: (projectId: string) => void;
  onRenameProject: (projectId: string, name: string) => void;
  onToggle: () => void;
  onSettings: () => void;
}

function groupOf(updatedAt: number, now: Date): string {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  if (updatedAt >= startOfToday) return t("sidebar.today");
  if (updatedAt >= startOfToday - day) return t("sidebar.yesterday");
  if (updatedAt >= startOfToday - 6 * day) return t("sidebar.week");
  if (updatedAt >= startOfToday - 29 * day) return t("sidebar.month");
  return t("sidebar.older");
}

function RenameField({ title, onDone }: { title: string; onDone: (title: string | null) => void }) {
  const [value, setValue] = useState(title);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") onDone(value.trim() || null);
    if (event.key === "Escape") onDone(null);
  };
  return (
    <input
      className="chat-row-rename"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => onDone(value.trim() || null)}
      onFocus={(event) => event.target.select()}
      aria-label={t("sidebar.rename")}
      maxLength={120}
      autoFocus
    />
  );
}

function ChatRow({ chat, active, branch, onSelect, onDelete, onRename, onPin }: {
  chat: ChatSummary;
  active: boolean;
  /** Listed below the chat it branched off. */
  branch?: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  onPin: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(timer);
  }, [confirming]);

  if (renaming) {
    return (
      <li className="chat-row is-renaming">
        <RenameField
          title={chat.title}
          onDone={(title) => {
            setRenaming(false);
            if (title && title !== chat.title) onRename(title);
          }}
        />
      </li>
    );
  }

  return (
    <li className={`chat-row${active ? " is-active" : ""}${confirming ? " is-confirming" : ""}${branch ? " is-branch" : ""}`}>
      <button
        type="button"
        className="chat-row-main"
        onClick={onSelect}
        onDoubleClick={() => setRenaming(true)}
        onKeyDown={(event) => event.key === "F2" && setRenaming(true)}
        aria-current={active ? "page" : undefined}
        title={t("sidebar.renameHint")}
      >
        {branch && <BranchIcon size={13} className="chat-row-branch" />}
        {chat.title}
      </button>
      {confirming ? (
        <button
          type="button"
          className="chat-row-confirm"
          onClick={onDelete}
          // Escape or clicking elsewhere cancels; the button has focus so ↩ confirms.
          onKeyDown={(event) => event.key === "Escape" && setConfirming(false)}
          onBlur={() => setConfirming(false)}
          // Safari moves focus away on mousedown, which would cancel before the click lands.
          onMouseDown={(event) => event.preventDefault()}
          autoFocus
        >
          <TrashIcon size={13} />
          {t("sidebar.confirmDelete")}
        </button>
      ) : (
        <span className="chat-row-actions">
          <button
            type="button"
            className="chat-row-action"
            onClick={onPin}
            aria-label={t(chat.pinned ? "sidebar.unpinLabel" : "sidebar.pinLabel", { title: chat.title })}
            title={t(chat.pinned ? "sidebar.unpin" : "sidebar.pin")}
          >
            <PinIcon size={15} />
          </button>
          <button
            type="button"
            className="chat-row-action is-delete"
            onClick={() => setConfirming(true)}
            aria-label={t("sidebar.deleteLabel", { title: chat.title })}
            title={t("sidebar.delete")}
          >
            <TrashIcon size={15} />
          </button>
        </span>
      )}
    </li>
  );
}

const EXPANDED_KEY = "expanded-projects";

function readExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function ProjectRow(props: {
  project: Project;
  open: boolean;
  onToggle: () => void;
  onNew: () => void;
  onRemove: () => void;
  onRename: (name: string) => void;
}) {
  const { project, open, onToggle, onNew, onRemove, onRename } = props;
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);

  if (renaming) {
    return (
      <div className="project-row is-renaming">
        <RenameField
          title={project.name}
          onDone={(name) => {
            setRenaming(false);
            if (name && name !== project.name) onRename(name);
          }}
        />
      </div>
    );
  }

  return (
    <div className={`project-row${confirming ? " is-confirming" : ""}`}>
      <button
        type="button"
        className="project-main"
        onClick={onToggle}
        onDoubleClick={() => setRenaming(true)}
        aria-expanded={open}
        title={project.path}
      >
        <ChevronRightIcon size={12} className={`project-chevron${open ? " is-open" : ""}`} />
        <FolderIcon size={15} className="project-icon" />
        <span className="project-label">{project.name}</span>
      </button>
      {confirming ? (
        <button
          type="button"
          className="chat-row-confirm"
          onClick={onRemove}
          onKeyDown={(event) => event.key === "Escape" && setConfirming(false)}
          onBlur={() => setConfirming(false)}
          // Safari moves focus away on mousedown, which would cancel before the click lands.
          onMouseDown={(event) => event.preventDefault()}
          autoFocus
        >
          {t("sidebar.removeProject")}
        </button>
      ) : (
        <span className="chat-row-actions">
          <button
            type="button"
            className="chat-row-action"
            onClick={onNew}
            aria-label={t("sidebar.newInProject", { name: project.name })}
            title={t("sidebar.newInProject", { name: project.name })}
          >
            <PlusIcon size={15} />
          </button>
          <button
            type="button"
            className="chat-row-action is-delete"
            onClick={() => setConfirming(true)}
            aria-label={t("sidebar.removeProjectLabel", { name: project.name })}
            title={t("sidebar.removeProjectHint")}
          >
            <CloseIcon size={14} />
          </button>
        </span>
      )}
    </div>
  );
}

export function Sidebar(props: Props) {
  const { summaries, projects, activeId, activeProjectId, usage, onSelect, onNew, onDelete, onRename, onPin } = props;
  const { onToggle, onSettings, onAddProject, onNewInProject, onRemoveProject, onRenameProject, projectError } = props;
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(readExpanded);
  const language = useLanguage();
  const needle = query.trim().toLowerCase();

  const toggleProject = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
      } catch {
        // Expansion is a convenience.
      }
      return next;
    });
  };

  // The project of the open chat is always shown expanded.
  useEffect(() => {
    if (activeProjectId && !expanded.has(activeProjectId)) toggleProject(activeProjectId);
  }, [activeProjectId]);

  const owner = (chat: ChatSummary) => projectFor(chat, projects)?.id;
  // Branches are listed below the chat they branched off, while it exists.
  const branches = useMemo(() => {
    const ids = new Set(summaries.map((chat) => chat.id));
    const byParent = new Map<string, ChatSummary[]>();
    for (const chat of summaries) {
      if (!chat.branchOf || !ids.has(chat.branchOf)) continue;
      byParent.set(chat.branchOf, [...(byParent.get(chat.branchOf) ?? []), chat]);
    }
    return byParent;
  }, [summaries]);
  const isNested = (chat: ChatSummary) => Boolean(chat.branchOf && branches.get(chat.branchOf)?.includes(chat));
  const matches = (chat: ChatSummary) =>
    !isNested(chat) &&
    (!needle ||
      chat.title.toLowerCase().includes(needle) ||
      (branches.get(chat.id) ?? []).some((branch) => branch.title.toLowerCase().includes(needle)));

  const projectChats = useMemo(() => {
    const byProject = new Map<string, ChatSummary[]>();
    for (const chat of summaries) {
      const projectId = owner(chat);
      if (!projectId || !matches(chat)) continue;
      byProject.set(projectId, [...(byProject.get(projectId) ?? []), chat]);
    }
    return byProject;
  }, [summaries, projects, needle, branches]);

  const groups = useMemo(() => {
    const now = new Date();
    const loose = summaries.filter((chat) => !owner(chat) && matches(chat));
    const result: { label: string; chats: ChatSummary[] }[] = [];
    const pinned = loose.filter((chat) => chat.pinned);
    if (pinned.length) result.push({ label: t("sidebar.pinned"), chats: pinned });
    for (const chat of loose) {
      if (chat.pinned) continue;
      const label = groupOf(chat.updatedAt, now);
      const group = result.find((entry) => entry.label === label);
      if (group) group.chats.push(chat);
      else result.push({ label, chats: [chat] });
    }
    return result;
    // The group labels are translated, so they are rebuilt when the language changes.
  }, [summaries, projects, needle, language, branches]);

  const visibleProjects = projects.filter(
    (project) => !needle || project.name.toLowerCase().includes(needle) || projectChats.has(project.id),
  );

  const single = (chat: ChatSummary, branch = false) => (
    <ChatRow
      key={chat.id}
      chat={chat}
      active={chat.id === activeId}
      branch={branch}
      onSelect={() => onSelect(chat.id)}
      onDelete={() => onDelete(chat.id)}
      onRename={(title) => onRename(chat.id, title)}
      onPin={() => onPin(chat.id)}
    />
  );
  const row = (chat: ChatSummary) => [single(chat), ...(branches.get(chat.id) ?? []).map((branch) => single(branch, true))];

  const share = usage ? Math.min(1, usage.usd / usage.budget) : 0;
  const monthName = usage
    ? new Intl.DateTimeFormat(locale(), { month: "long" }).format(new Date(`${usage.month}-01T12:00:00`))
    : "";

  return (
    <aside className="sidebar">
      <div className="sidebar-top" data-tauri-drag-region>
        <button type="button" className="icon-button" onClick={onToggle} aria-label={t("sidebar.hide")} title={t("sidebar.shortcut")}>
          <SidebarIcon />
        </button>
        <button type="button" className="icon-button" onClick={onNew} aria-label={t("sidebar.new")} title={t("sidebar.newShortcut")}>
          <ComposeIcon />
        </button>
      </div>

      <label className="search">
        <SearchIcon size={14} />
        <input
          type="search"
          placeholder={t("sidebar.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t("sidebar.search")}
        />
      </label>

      <nav className="chat-list" aria-label={t("sidebar.chats")}>
        <section className="projects">
          <div className="section-head">
            <h2 className="group-label">{t("sidebar.projects")}</h2>
            <button
              type="button"
              className="section-action"
              onClick={onAddProject}
              aria-label={t("sidebar.addProject")}
              title={t("sidebar.addProject")}
            >
              <PlusIcon size={14} />
            </button>
          </div>
          {projectError && (
            <p className="project-error" role="alert">
              {projectError}
            </p>
          )}
          {projects.length === 0 && (
            <button type="button" className="project-empty" onClick={onAddProject}>
              {t("sidebar.addProjectHint")}
            </button>
          )}
          {visibleProjects.map((project) => {
            const open = expanded.has(project.id) || Boolean(needle);
            const chats = projectChats.get(project.id) ?? [];
            return (
              <div key={project.id} className="project">
                <ProjectRow
                  project={project}
                  open={open}
                  onToggle={() => toggleProject(project.id)}
                  onNew={() => onNewInProject(project.id)}
                  onRemove={() => onRemoveProject(project.id)}
                  onRename={(name) => onRenameProject(project.id, name)}
                />
                {open && (
                  <ul className="project-chats">
                    {chats.map(row)}
                    {chats.length === 0 && !needle && (
                      <li>
                        <button type="button" className="project-start" onClick={() => onNewInProject(project.id)}>
                          {t("sidebar.projectStart")}
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            );
          })}
        </section>

        {groups.map((group) => (
          <section key={group.label}>
            <h2 className="group-label">{group.label}</h2>
            <ul>{group.chats.map(row)}</ul>
          </section>
        ))}
        {summaries.length === 0 && projects.length === 0 && <p className="list-empty">{t("sidebar.empty")}</p>}
        {needle && groups.length === 0 && visibleProjects.length === 0 && (
          <p className="list-empty">{t("sidebar.noMatch")}</p>
        )}
      </nav>

      <div className="sidebar-foot">
        <button
          type="button"
          className="usage"
          onClick={onSettings}
          title={
            usage
              ? t("sidebar.spendHint", { budget: formatUsd(usage.budget) })
              : t("sidebar.settings")
          }
        >
          <span className="usage-head">
            {usage ? t("sidebar.spendTitle", { month: monthName }) : t("sidebar.spendFallback")}
            <GearIcon size={15} className="usage-gear" />
          </span>
          {usage && (
            <>
              <span className="usage-figures">
                <span className="usage-amount">{formatUsd(usage.usd)}</span>
                <span className="usage-budget">{t("sidebar.spendOf", { budget: formatUsd(usage.budget) })}</span>
              </span>
              <span className="meter" aria-hidden="true">
                {/* Any spend shows at least a sliver, so the bar never looks unused. */}
                <span
                  className={`meter-fill${share >= 0.9 ? " is-high" : ""}`}
                  style={{ transform: `scaleX(${usage.usd > 0 ? Math.max(share, 0.03) : 0})` }}
                />
              </span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
