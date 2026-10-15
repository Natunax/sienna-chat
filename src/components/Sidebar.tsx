import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { formatUsd, type ChatSummary, type Usage } from "../api";
import { locale, t } from "../i18n";
import { ComposeIcon, GearIcon, PinIcon, SearchIcon, SidebarIcon, TrashIcon } from "./icons";

interface Props {
  summaries: ChatSummary[];
  activeId: string | null;
  usage: Usage | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string) => void;
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

function ChatRow({ chat, active, onSelect, onDelete, onRename, onPin }: {
  chat: ChatSummary;
  active: boolean;
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
    <li className={`chat-row${active ? " is-active" : ""}`}>
      <button
        type="button"
        className="chat-row-main"
        onClick={onSelect}
        onDoubleClick={() => setRenaming(true)}
        onKeyDown={(event) => event.key === "F2" && setRenaming(true)}
        aria-current={active ? "page" : undefined}
        title={t("sidebar.renameHint")}
      >
        {chat.title}
      </button>
      {confirming ? (
        <button type="button" className="chat-row-confirm" onClick={onDelete}>
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

export function Sidebar(props: Props) {
  const { summaries, activeId, usage, onSelect, onNew, onDelete, onRename, onPin, onToggle, onSettings } = props;
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const now = new Date();
    const needle = query.trim().toLowerCase();
    const result: { label: string; chats: ChatSummary[] }[] = [];
    const pinned = summaries.filter((chat) => chat.pinned && (!needle || chat.title.toLowerCase().includes(needle)));
    if (pinned.length) result.push({ label: t("sidebar.pinned"), chats: pinned });
    for (const chat of summaries) {
      if (chat.pinned) continue;
      if (needle && !chat.title.toLowerCase().includes(needle)) continue;
      const label = groupOf(chat.updatedAt, now);
      const group = result.find((entry) => entry.label === label);
      if (group) group.chats.push(chat);
      else result.push({ label, chats: [chat] });
    }
    return result;
  }, [summaries, query]);

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
        {groups.map((group) => (
          <section key={group.label}>
            <h2 className="group-label">{group.label}</h2>
            <ul>
              {group.chats.map((chat) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  active={chat.id === activeId}
                  onSelect={() => onSelect(chat.id)}
                  onDelete={() => onDelete(chat.id)}
                  onRename={(title) => onRename(chat.id, title)}
                  onPin={() => onPin(chat.id)}
                />
              ))}
            </ul>
          </section>
        ))}
        {summaries.length === 0 && <p className="list-empty">{t("sidebar.empty")}</p>}
        {summaries.length > 0 && groups.length === 0 && <p className="list-empty">{t("sidebar.noMatch")}</p>}
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
          <span className="usage-text">
            <span className="usage-amount">
              {usage ? t("sidebar.spend", { amount: formatUsd(usage.usd) }) : t("sidebar.spendFallback")}
            </span>
            <span className="usage-month">{monthName}</span>
          </span>
          <span className="meter" aria-hidden="true">
            <span className={`meter-fill${share >= 0.9 ? " is-high" : ""}`} style={{ width: `${share * 100}%` }} />
          </span>
          <GearIcon size={16} className="usage-gear" />
        </button>
      </div>
    </aside>
  );
}
