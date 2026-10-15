import { useEffect, useRef, useState } from "react";
import type { ContextCategory } from "../api";
import { locale, t, type TextKey } from "../i18n";
import { useMenuFocus } from "./useMenuFocus";

/** Token counts in a short form: 950, 12.3k, 200k, 1M. */
export function shortTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`;
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}k`;
  if (tokens >= 1000) return `${Number((tokens / 1000).toFixed(1))}k`;
  return String(tokens);
}

// The category names come from Claude Code in English.
const CATEGORY_NAMES: Record<string, TextKey> = {
  "System prompt": "context.system",
  "System tools": "context.tools",
  Messages: "context.messages",
  "Free space": "context.free",
  "Autocompact buffer": "context.buffer",
  "Memory files": "context.memory",
  "MCP tools": "context.mcp",
  "Custom agents": "context.agents",
  Skills: "context.skills",
};

function categoryName(name: string): string {
  const key = CATEGORY_NAMES[name];
  return key ? t(key) : name;
}

interface Props {
  used: number;
  window: number;
  categories?: ContextCategory[];
  /** Missing until the chat has an answer, or while one streams. */
  onCompact?: () => void;
  compacting: boolean;
}

/** How full the chat's context window is; opens the details and the compact button. */
export function ContextMeter({ used, window, categories = [], onCompact, compacting }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Focus goes into the details and back to the meter, as in the menus.
  useMenuFocus(open, panel, trigger);
  const ratio = Math.min(1, used / window);
  const percent = Math.round(ratio * 100);
  const radius = 5.5;
  const circumference = 2 * Math.PI * radius;
  const exact = new Intl.NumberFormat(locale());
  const buffer = categories.find((entry) => entry.kind === "buffer")?.tokens ?? 0;
  const shown = categories.filter((entry) => entry.kind === "used");

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="menu-anchor context-anchor" ref={ref}>
      <button
        ref={trigger}
        type="button"
        className={`context-meter${ratio >= 0.8 ? " is-high" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? "context-panel" : undefined}
        aria-label={t("composer.context", { percent, used: exact.format(used), window: exact.format(window) })}
        title={t("composer.context", { percent, used: exact.format(used), window: exact.format(window) })}
        onClick={() => setOpen(!open)}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle className="context-track" cx="7" cy="7" r={radius} />
          <circle
            className="context-fill"
            cx="7"
            cy="7"
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
          />
        </svg>
        <span className="context-figures">
          {shortTokens(used)} / {shortTokens(window)}
          {/* Nearly full is said in words too, not only by the ring's color. */}
          {ratio >= 0.8 && <span className="context-warning"> · {t("context.high", { percent })}</span>}
        </span>
      </button>
      {open && (
        <div
          ref={panel}
          id="context-panel"
          className="menu context-panel"
          role="dialog"
          aria-label={t("context.title")}
          tabIndex={-1}
        >
          <div className="context-head">
            <span className="context-title">{t("context.title")}</span>
            <span className="context-percent">{percent} %</span>
          </div>
          <p className="context-total">
            {t("context.of", { used: exact.format(used), window: exact.format(window) })}
          </p>
          <div className="context-bar" aria-hidden="true">
            {shown.map((entry) => (
              <span
                key={entry.name}
                className={`context-segment is-${entry.name === "Messages" ? "messages" : "other"}`}
                style={{ width: `${(entry.tokens / window) * 100}%` }}
              />
            ))}
          </div>
          {shown.length > 0 && (
            <dl className="context-rows">
              {shown.map((entry) => (
                <div key={entry.name} className="context-row">
                  <dt>
                    <span className={`context-dot is-${entry.name === "Messages" ? "messages" : "other"}`} />
                    {categoryName(entry.name)}
                  </dt>
                  <dd>{shortTokens(entry.tokens)}</dd>
                </div>
              ))}
            </dl>
          )}
          {buffer > 0 && (
            <p className="context-note">{t("context.auto", { threshold: shortTokens(window - buffer) })}</p>
          )}
          <div className="context-actions">
            <button
              type="button"
              className="secondary-button"
              data-menu-item
              disabled={!onCompact || compacting}
              onClick={() => {
                onCompact?.();
                setOpen(false);
              }}
            >
              {compacting ? t("context.compacting") : t("context.compact")}
            </button>
            <span className="context-hint">{onCompact ? t("context.compactHint") : t("context.compactLater")}</span>
          </div>
        </div>
      )}
    </div>
  );
}
