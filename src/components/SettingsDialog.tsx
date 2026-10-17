import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { setAutoApprove, useAutoApprove } from "../autoApprove";
import { api, formatUsd, MODELS, type Usage } from "../api";
import { errorText, languageChoice, setLanguageChoice, t, type LanguageChoice, type TextKey } from "../i18n";
import { coverWindow } from "../overlay";
import { setUsage } from "../store";
import { CloseIcon, CoinsIcon, GearIcon, KeyboardIcon, KeyIcon, ShieldCheckIcon } from "./icons";
import { KeyForm } from "./KeyForm";

const CONSOLE_USAGE_URL = "https://platform.claude.com/settings/billing";

// Every shortcut of the app, listed in the settings.
const SHORTCUTS: { keys: string; label: TextKey }[] = [
  { keys: "⌘N", label: "shortcut.new" },
  { keys: "⌘K", label: "shortcut.search" },
  { keys: "⌘\\", label: "shortcut.sidebar" },
  { keys: "⌘,", label: "shortcut.settings" },
  { keys: "⌘.", label: "shortcut.stop" },
  { keys: "⌥↩", label: "shortcut.newline" },
  { keys: "/", label: "shortcut.commands" },
  { keys: "@", label: "shortcut.mention" },
  { keys: "⌥Space", label: "shortcut.dictate" },
  { keys: "⌘↩", label: "shortcut.allow" },
  { keys: "Esc", label: "shortcut.deny" },
  { keys: "1–4", label: "shortcut.modes" },
  { keys: "F2", label: "shortcut.rename" },
];

// Language names stay in their own language, so each is recognizable in both.
const LANGUAGES: { id: LanguageChoice; name: string }[] = [
  { id: "system", name: "" },
  { id: "de", name: "Deutsch" },
  { id: "en", name: "English" },
];

type PageId = "general" | "projects" | "key" | "costs" | "shortcuts";

const PAGES: { id: PageId; label: TextKey; icon: (props: { size?: number }) => ReactNode }[] = [
  { id: "general", label: "settings.nav.general", icon: GearIcon },
  { id: "projects", label: "settings.nav.projects", icon: ShieldCheckIcon },
  { id: "key", label: "settings.nav.key", icon: KeyIcon },
  { id: "costs", label: "settings.nav.costs", icon: CoinsIcon },
  { id: "shortcuts", label: "settings.nav.shortcuts", icon: KeyboardIcon },
];

/** One setting: what it is and what it does on the left, its control on the right. */
function Row({ id, title, hint, children }: { id: string; title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-title" id={`${id}-label`}>
          {title}
        </div>
        {hint && (
          <p className="settings-row-hint" id={`${id}-hint`}>
            {hint}
          </p>
        )}
      </div>
      {children && <div className="settings-row-control">{children}</div>}
    </div>
  );
}

interface Props {
  usage: Usage | null;
  onClose: () => void;
  onKeyRemoved: () => void;
}

export function SettingsDialog({ usage, onClose, onKeyRemoved }: Props) {
  const autoApprove = useAutoApprove();
  const dialog = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState<PageId>("general");
  const [replacing, setReplacing] = useState(false);
  const [budget, setBudget] = useState(String(usage?.budget ?? 100));
  const [keyMessage, setKeyMessage] = useState<string | null>(null);
  const [budgetMessage, setBudgetMessage] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [language, setLanguage] = useState<LanguageChoice>(languageChoice);

  useEffect(() => {
    // Back to the button that opened the settings when they close.
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    // Focus the dialog itself, not its first button, so no focus ring shows on open.
    dialog.current?.focus();
    const uncover = coverWindow();
    return () => {
      uncover();
      opener?.focus?.();
    };
  }, []);

  useEffect(() => {
    if (!confirmRemove) return;
    const timer = setTimeout(() => setConfirmRemove(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmRemove]);

  const saveBudget = async () => {
    const value = Number(budget.replace(",", "."));
    try {
      setUsage(await api.budgetSet(value));
      setBudgetMessage(t("settings.budgetSaved"));
    } catch (reason) {
      setBudgetMessage(errorText(reason));
    }
  };

  const removeKey = async () => {
    try {
      await api.keyDelete();
      onKeyRemoved();
    } catch (reason) {
      setKeyMessage(errorText(reason));
    }
  };

  const current = PAGES.find((entry) => entry.id === page)!;
  const byModel = Object.entries(usage?.byModel ?? {}).sort(([, a], [, b]) => b - a);

  return (
    <dialog
      ref={dialog}
      className="dialog settings"
      tabIndex={-1}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby="settings-title"
    >
      <nav
        className="settings-nav"
        aria-labelledby="settings-title"
        // Up and down move between the categories, as in a Mac sidebar.
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const at = PAGES.findIndex((entry) => entry.id === page);
          const next = PAGES[(at + (event.key === "ArrowDown" ? 1 : -1) + PAGES.length) % PAGES.length];
          setPage(next.id);
          event.currentTarget.querySelector<HTMLElement>(`[data-page="${next.id}"]`)?.focus();
        }}
      >
        <h2 id="settings-title" className="settings-nav-title">
          {t("settings.title")}
        </h2>
        {PAGES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            data-page={id}
            className={`settings-nav-item${id === page ? " is-active" : ""}`}
            aria-current={id === page ? "page" : undefined}
            onClick={() => setPage(id)}
          >
            <Icon size={16} />
            {t(label)}
          </button>
        ))}
      </nav>

      <div className="settings-page">
        <button type="button" className="icon-button settings-close" onClick={onClose} aria-label={t("settings.close")}>
          <CloseIcon />
        </button>
        <h3 className="settings-page-title">{t(current.label)}</h3>

        {page === "general" && (
          <Row id="language" title={t("settings.language")} hint={t("settings.languageHint")}>
            <div className="segmented settings-segmented" role="group" aria-labelledby="language-label">
              {LANGUAGES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={option.id === language}
                  className={option.id === language ? "is-active" : undefined}
                  onClick={() => {
                    setLanguage(option.id);
                    setLanguageChoice(option.id);
                  }}
                >
                  {option.id === "system" ? t("settings.languageSystem") : option.name}
                </button>
              ))}
            </div>
          </Row>
        )}

        {page === "projects" && (
          <Row id="auto-approve" title={t("settings.autoApprove")} hint={t("settings.autoApproveHint")}>
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={autoApprove}
              aria-labelledby="auto-approve-label"
              aria-describedby="auto-approve-hint"
              onClick={() => setAutoApprove(!autoApprove)}
            >
              <span className="switch-knob" />
            </button>
          </Row>
        )}

        {page === "key" && (
          <>
            <Row id="key" title={t("settings.keyStored")} hint={t("settings.keyHint")}>
              {!replacing && (
                <>
                  <button type="button" className="secondary-button" onClick={() => setReplacing(true)}>
                    {t("settings.replace")}
                  </button>
                  {/* Removing the key ends every chat until a new one is entered, so it asks once more. */}
                  <button
                    type="button"
                    className={`secondary-button is-danger${confirmRemove ? " is-confirming" : ""}`}
                    onClick={() => (confirmRemove ? void removeKey() : setConfirmRemove(true))}
                  >
                    {t(confirmRemove ? "settings.removeConfirm" : "settings.remove")}
                  </button>
                </>
              )}
            </Row>
            {replacing && (
              <div className="settings-block">
                <KeyForm
                  onSaved={() => {
                    setReplacing(false);
                    setKeyMessage(t("settings.keySaved"));
                  }}
                />
              </div>
            )}
            {keyMessage && (
              <p className="settings-message" role="status">
                {keyMessage}
              </p>
            )}
          </>
        )}

        {page === "costs" && (
          <>
            <Row id="budget" title={t("settings.budget")} hint={t("settings.budgetHint")}>
              <label className="budget-field">
                <span aria-hidden="true">$</span>
                <input
                  className="field"
                  inputMode="decimal"
                  value={budget}
                  onChange={(event) => {
                    setBudget(event.target.value);
                    setBudgetMessage(null);
                  }}
                  onKeyDown={(event) => event.key === "Enter" && void saveBudget()}
                  aria-label={t("settings.budgetLabel")}
                />
              </label>
              <button type="button" className="secondary-button" onClick={() => void saveBudget()}>
                {t("settings.budgetSave")}
              </button>
            </Row>
            {budgetMessage && (
              <p className="settings-message" role="status">
                {budgetMessage}
              </p>
            )}
            <Row id="costs" title={t("settings.costs")} hint={t("settings.costsHint")} />
            {byModel.length ? (
              <dl className="cost-list">
                {byModel.map(([model, usd]) => (
                  <div key={model} className="cost-row">
                    <dt>{MODELS.find((entry) => entry.id === model)?.name ?? t("model.other")}</dt>
                    <dd>{formatUsd(usd)}</dd>
                  </div>
                ))}
                <div className="cost-row is-total">
                  <dt>{t("settings.costsTotal")}</dt>
                  <dd>{formatUsd(usage?.usd ?? 0)}</dd>
                </div>
              </dl>
            ) : (
              <p className="settings-empty">{t("settings.noCosts")}</p>
            )}
            <button type="button" className="link-button cost-link" onClick={() => void openUrl(CONSOLE_USAGE_URL)}>
              {t("settings.console")}
            </button>
          </>
        )}

        {page === "shortcuts" && (
          <dl className="shortcut-list">
            {SHORTCUTS.map((shortcut) => (
              <div key={shortcut.keys} className="shortcut-row">
                <dt>{t(shortcut.label)}</dt>
                <dd>
                  <kbd>{shortcut.keys}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </dialog>
  );
}
