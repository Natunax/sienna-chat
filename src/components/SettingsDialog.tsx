import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { api, formatUsd, MODELS, type Usage } from "../api";
import { errorText, languageChoice, setLanguageChoice, t, type LanguageChoice, type TextKey } from "../i18n";
import { setUsage } from "../store";
import { CloseIcon, KeyIcon } from "./icons";
import { KeyForm } from "./KeyForm";

const CONSOLE_USAGE_URL = "https://platform.claude.com/settings/billing";

// Language names stay in their own language, so each is recognizable in both.
// Every shortcut of the app, listed in the settings.
const SHORTCUTS: { keys: string; label: TextKey }[] = [
  { keys: "⌘N", label: "shortcut.new" },
  { keys: "⌘K", label: "shortcut.search" },
  { keys: "⌘\\", label: "shortcut.sidebar" },
  { keys: "⌘,", label: "shortcut.settings" },
  { keys: "⌘.", label: "shortcut.stop" },
  { keys: "/", label: "shortcut.commands" },
  { keys: "@", label: "shortcut.mention" },
  { keys: "⌥Space", label: "shortcut.dictate" },
  { keys: "⌘↩", label: "shortcut.allow" },
  { keys: "Esc", label: "shortcut.deny" },
  { keys: "1–4", label: "shortcut.modes" },
  { keys: "F2", label: "shortcut.rename" },
];

const LANGUAGES: { id: LanguageChoice; name: string }[] = [
  { id: "system", name: "" },
  { id: "de", name: "Deutsch" },
  { id: "en", name: "English" },
];

interface Props {
  usage: Usage | null;
  onClose: () => void;
  onKeyRemoved: () => void;
}

export function SettingsDialog({ usage, onClose, onKeyRemoved }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
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
    return () => opener?.focus?.();
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

  return (
    <dialog
      ref={dialog}
      className="dialog"
      tabIndex={-1}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby="settings-title"
    >
      <header className="dialog-head">
        <h2 id="settings-title">{t("settings.title")}</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t("settings.close")}>
          <CloseIcon />
        </button>
      </header>

      <section className="setting">
        <h3>{t("settings.language")}</h3>
        <div className="segmented setting-segmented" role="group" aria-label={t("settings.language")}>
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
      </section>

      <section className="setting">
        <h3>{t("settings.key")}</h3>
        {replacing ? (
          <KeyForm
            onSaved={() => {
              setReplacing(false);
              setKeyMessage(t("settings.keySaved"));
            }}
          />
        ) : (
          <div className="setting-row">
            <span className="setting-value">
              <KeyIcon size={16} />
              {t("settings.keyStored")}
            </span>
            <span className="setting-actions">
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
            </span>
          </div>
        )}
        {keyMessage && (
          <p className="setting-message" role="status">
            {keyMessage}
          </p>
        )}
      </section>

      <section className="setting">
        <h3>{t("settings.costs")}</h3>
        <p className="setting-hint">{t("settings.costsHint")}</p>
        {usage && Object.keys(usage.byModel ?? {}).length ? (
          <dl className="cost-list">
            {Object.entries(usage.byModel)
              .sort(([, a], [, b]) => b - a)
              .map(([model, usd]) => (
                <div key={model} className="cost-row">
                  <dt>{MODELS.find((entry) => entry.id === model)?.name ?? t("model.other")}</dt>
                  <dd>{formatUsd(usd)}</dd>
                </div>
              ))}
            <div className="cost-row is-total">
              <dt>{t("settings.costsTotal")}</dt>
              <dd>{formatUsd(usage.usd)}</dd>
            </div>
          </dl>
        ) : (
          <p className="setting-hint">{t("settings.noCosts")}</p>
        )}
        <button type="button" className="link-button cost-link" onClick={() => void openUrl(CONSOLE_USAGE_URL)}>
          {t("settings.console")}
        </button>
      </section>

      <section className="setting">
        <h3>{t("settings.budget")}</h3>
        <p className="setting-hint">{t("settings.budgetHint")}</p>
        <div className="setting-row">
          <label className="budget-field">
            <span>$</span>
            <input
              className="field"
              inputMode="decimal"
              value={budget}
              onChange={(event) => {
                setBudget(event.target.value);
                setBudgetMessage(null);
              }}
              aria-label={t("settings.budgetLabel")}
            />
          </label>
          <span className="setting-actions">
            <span className="setting-status" role="status">
              {budgetMessage}
            </span>
            <button type="button" className="secondary-button" onClick={() => void saveBudget()}>
              {t("settings.budgetSave")}
            </button>
          </span>
        </div>
      </section>

      <section className="setting">
        <h3>{t("settings.shortcuts")}</h3>
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
      </section>
    </dialog>
  );
}
