import { useEffect, useRef, useState } from "react";
import { api, errorText, formatUsd, MODELS, type Usage } from "../api";
import { setUsage } from "../store";
import { CloseIcon, KeyIcon } from "./icons";
import { KeyForm } from "./KeyForm";

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
      setMessage("Budget gespeichert.");
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
        <h2>Einstellungen</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Schließen">
          <CloseIcon />
        </button>
      </header>

      <section className="setting">
        <h3>API-Key</h3>
        {replacing ? (
          <KeyForm
            onSaved={() => {
              setReplacing(false);
              setMessage("Neuer Key gespeichert.");
            }}
          />
        ) : (
          <div className="setting-row">
            <span className="setting-value">
              <KeyIcon size={16} />
              Im Schlüsselbund gespeichert
            </span>
            <span className="setting-actions">
              <button type="button" className="secondary-button" onClick={() => setReplacing(true)}>
                Ersetzen
              </button>
              <button type="button" className="secondary-button is-danger" onClick={() => void removeKey()}>
                Entfernen
              </button>
            </span>
          </div>
        )}
      </section>

      <section className="setting">
        <h3>Kosten diesen Monat</h3>
        {usage && Object.keys(usage.byModel ?? {}).length ? (
          <dl className="cost-list">
            {Object.entries(usage.byModel)
              .sort(([, a], [, b]) => b - a)
              .map(([model, usd]) => (
                <div key={model} className="cost-row">
                  <dt>{MODELS.find((entry) => entry.id === model)?.name ?? "Sonstige"}</dt>
                  <dd>{formatUsd(usd)}</dd>
                </div>
              ))}
            <div className="cost-row is-total">
              <dt>Gesamt</dt>
              <dd>{formatUsd(usage.usd)}</dd>
            </div>
          </dl>
        ) : (
          <p className="setting-hint">Noch keine Kosten in diesem Monat.</p>
        )}
      </section>

      <section className="setting">
        <h3>Monatsbudget</h3>
        <p className="setting-hint">
          Ist das Budget erreicht, nimmt die App keine Nachrichten mehr an. Setz zusätzlich ein Ausgabenlimit in der
          Claude Console.
        </p>
        <div className="setting-row">
          <label className="budget-field">
            <span>$</span>
            <input
              className="field"
              inputMode="decimal"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              aria-label="Monatsbudget in Dollar"
            />
          </label>
          <button type="button" className="secondary-button" onClick={() => void saveBudget()}>
            Budget speichern
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
