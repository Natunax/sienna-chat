import { useEffect, useRef, useState } from "react";
import { DEFAULT_MODE, MODES, type PermissionMode } from "../api";
import { t } from "../i18n";
import { CheckIcon } from "./icons";

interface Props {
  mode: PermissionMode;
  onChange: (mode: PermissionMode) => void;
}

function modeName(mode: PermissionMode): string {
  if (mode === "bypassPermissions") return t("mode.bypass");
  if (mode === "acceptEdits") return t("mode.acceptEditsShort");
  return t(MODES.find((entry) => entry.id === mode)?.name ?? "mode.auto");
}

/** How far Claude may go without asking, as Claude Code's mode menu. Keys 1–4 pick a mode while it is open. */
export function ModeMenu({ mode, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const bypass = mode === "bypassPermissions";

  const pick = (next: PermissionMode) => {
    onChange(next);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) {
      setConfirming(false);
      return;
    }
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && MODES[index] && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        onChange(MODES[index].id);
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", keys);
    };
  }, [open, onChange]);

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        className={`pill mode-pill${bypass ? " is-danger" : mode === "plan" ? " is-plan" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("mode.title")}
        onClick={() => setOpen(!open)}
      >
        {modeName(mode)}
      </button>
      {open && (
        <div className="menu mode-menu" role="menu" aria-label={t("mode.title")}>
          <div className="mode-head">{t("mode.title")}</div>
          {MODES.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              role="menuitemradio"
              aria-checked={entry.id === mode}
              className="mode-item"
              onClick={() => pick(entry.id)}
            >
              <span className="mode-text">
                <span className="mode-name">
                  {t(entry.name)}
                  {entry.id === DEFAULT_MODE && <span className="mode-tag">{t("mode.standard")}</span>}
                </span>
                <span className="mode-hint">{t(entry.hint)}</span>
              </span>
              <span className="mode-check">{entry.id === mode && <CheckIcon size={14} />}</span>
              <span className="mode-key">{index + 1}</span>
            </button>
          ))}
          <div className="mode-bypass">
            <span className="mode-text">
              <span className="mode-name">{t("mode.bypass")}</span>
              <span className="mode-hint">{t(confirming ? "mode.risky" : "mode.bypassHint")}</span>
            </span>
            {bypass ? (
              <span className="mode-check is-danger">
                <CheckIcon size={14} />
              </span>
            ) : (
              <button
                type="button"
                className={`mode-activate${confirming ? " is-confirming" : ""}`}
                onClick={() => (confirming ? pick("bypassPermissions") : setConfirming(true))}
              >
                {t(confirming ? "mode.confirm" : "mode.activate")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
