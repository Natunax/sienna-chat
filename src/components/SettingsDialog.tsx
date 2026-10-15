import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { api, formatUsd, MODELS, type Usage } from "../api";
import { errorText, t } from "../i18n";
import { setUsage } from "../store";
import { CloseIcon, KeyIcon } from "./icons";
import { KeyForm } from "./KeyForm";

const CONSOLE_USAGE_URL = "https://platform.claude.com/settings/billing";

interface Props {
  usage: Usage | null;
  onClose: () => void;
  onKeyRemoved: () => void;
}

export function SettingsDialog({ usage, onClose, onKeyRemoved }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [replacing, setReplacing] = useState(false);
  const [budget, setBudget] = useState(String(usage?.budget ?? 100));
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
    // Focus the dialog itself, not its first button, so no focus ring shows on open.
    dialog.current?.focus();
  }, []);

  const saveBudget = async () => {
    const value = Number(budget.replace(",", "."));
    try {
      setUsage(await api.budgetSet(value));
      setMessage(t("settings.budgetSaved"));
    } catch (reason) {
      setMessage(errorText(reason));
    }
  };

  const removeKey = async () => {
    try {
      await api.keyDelete();
      onKeyRemoved();
    } catch (reason) {
      setMessage(errorText(reason));
    }
  };

  return (
    <dialog ref={dialog} className="dialog" tabIndex={-1} onClose={onClose} onCancel={onClose}>
      <header className="dialog-head">
        <h2>{t("settings.title")}</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t("settings.close")}>
          <CloseIcon />
        </button>
      </header>

      <section className="setting">
        <h3>{t("settings.key")}</h3>
        {replacing ? (
          <KeyForm
            onSaved={() => {
              setReplacing(false);
              setMessage(t("settings.keySaved"));
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
              <button type="button" className="secondary-button is-danger" onClick={() => void removeKey()}>
                {t("settings.remove")}
              </button>
            </span>
          </div>
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
              onChange={(event) => setBudget(event.target.value)}
              aria-label={t("settings.budgetLabel")}
            />
          </label>
          <button type="button" className="secondary-button" onClick={() => void saveBudget()}>
            {t("settings.budgetSave")}
          </button>
        </div>
      </section>

      {message && (
        <p className="setting-message" role="status">
          {message}
        </p>
      )}
    </dialog>
  );
}
