import { useEffect, useRef, useState } from "react";
import { api, errorText, formatUsd, type Usage } from "../api";
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
    <dialog ref={dialog} className="dialog" onClose={onClose} onCancel={onClose}>
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
        <h3>Monatsbudget</h3>
        <p className="setting-hint">
          Diesen Monat verbraucht: {usage ? formatUsd(usage.usd) : "–"}. Ist das Budget erreicht, nimmt die App keine
          Nachrichten mehr an. Setz zusätzlich ein Ausgabenlimit in der Claude Console.
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
