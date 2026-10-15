import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { formatUsd, type ChatSummary, type Usage } from "../api";
import { ComposeIcon, GearIcon, SearchIcon, SidebarIcon, TrashIcon } from "./icons";

interface Props {
  summaries: ChatSummary[];
  activeId: string | null;
  usage: Usage | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onToggle: () => void;
  onSettings: () => void;
}

const MONTHS = new Intl.DateTimeFormat("de-DE", { month: "long" });

function groupOf(updatedAt: number, now: Date): string {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  if (updatedAt >= startOfToday) return "Heute";
  if (updatedAt >= startOfToday - day) return "Gestern";
  if (updatedAt >= startOfToday - 6 * day) return "Letzte 7 Tage";
  if (updatedAt >= startOfToday - 29 * day) return "Letzte 30 Tage";
  return "Älter";
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
      aria-label="Chat umbenennen"
      maxLength={120}
      autoFocus
    />
  );
}

function ChatRow({ chat, active, onSelect, onDelete, onRename }: {
  chat: ChatSummary;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
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
        title="Doppelklick zum Umbenennen"
      >
        {chat.title}
      </button>
      {confirming ? (
        <button type="button" className="chat-row-confirm" onClick={onDelete}>
          Löschen
        </button>
      ) : (
        <button
          type="button"
          className="chat-row-delete"
          onClick={() => setConfirming(true)}
          aria-label={`${chat.title} löschen`}
          title="Chat löschen"
        >
          <TrashIcon size={15} />
        </button>
      )}
    </li>
  );
}

export function Sidebar(props: Props) {
  const { summaries, activeId, usage, onSelect, onNew, onDelete, onRename, onToggle, onSettings } = props;
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const now = new Date();
    const needle = query.trim().toLowerCase();
    const result: { label: string; chats: ChatSummary[] }[] = [];
    for (const chat of summaries) {
      if (needle && !chat.title.toLowerCase().includes(needle)) continue;
      const label = groupOf(chat.updatedAt, now);
      const group = result.find((entry) => entry.label === label);
      if (group) group.chats.push(chat);
      else result.push({ label, chats: [chat] });
    }
    return result;
  }, [summaries, query]);

  const share = usage ? Math.min(1, usage.usd / usage.budget) : 0;
  const monthName = usage ? MONTHS.format(new Date(`${usage.month}-01T12:00:00`)) : "";

  return (
    <aside className="sidebar">
      <div className="sidebar-top" data-tauri-drag-region>
        <button type="button" className="icon-button" onClick={onToggle} aria-label="Seitenleiste ausblenden" title="Seitenleiste (⌘\)">
          <SidebarIcon />
        </button>
        <button type="button" className="icon-button" onClick={onNew} aria-label="Neuer Chat" title="Neuer Chat (⌘N)">
          <ComposeIcon />
        </button>
      </div>

      <label className="search">
        <SearchIcon size={14} />
        <input
          type="search"
          placeholder="Chats durchsuchen"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Chats durchsuchen"
        />
      </label>

      <nav className="chat-list" aria-label="Chats">
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
                />
              ))}
            </ul>
          </section>
        ))}
        {summaries.length === 0 && <p className="list-empty">Deine Chats erscheinen hier.</p>}
        {summaries.length > 0 && groups.length === 0 && <p className="list-empty">Kein Chat passt zur Suche.</p>}
      </nav>

      <div className="sidebar-foot">
        <button
          type="button"
          className="usage"
          onClick={onSettings}
          title={
            usage
              ? `Diesen Monat in Sienna, von ${formatUsd(usage.budget)} Budget. Den Gesamtverbrauch deiner Organisation zeigt die Claude Console. Einstellungen (⌘,)`
              : "Einstellungen (⌘,)"
          }
        >
          <span className="usage-text">
            <span className="usage-amount">
              {usage ? `${formatUsd(usage.usd)} in Sienna` : "Kosten"}
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
