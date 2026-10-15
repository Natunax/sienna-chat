import { openUrl } from "@tauri-apps/plugin-opener";
import { useState, type FormEvent } from "react";
import { api, errorText } from "../api";

const KEYS_URL = "https://platform.claude.com/settings/keys";

export function KeyForm({ onSaved, submitLabel = "Speichern" }: { onSaved: () => void; submitLabel?: string }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.keySave(key);
      setKey("");
      onSaved();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="key-form" onSubmit={submit}>
      <input
        type="password"
        className="field"
        placeholder="sk-ant-api03-…"
        value={key}
        onChange={(event) => setKey(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        aria-label="API-Key"
        autoFocus
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-row">
        <button type="button" className="link-button" onClick={() => void openUrl(KEYS_URL)}>
          Key in der Claude Console erstellen
        </button>
        <button type="submit" className="primary-button" disabled={!key.trim() || saving}>
          {saving ? "Speichert…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function Onboarding({ onSaved }: { onSaved: () => void }) {
  return (
    <div className="onboarding" data-tauri-drag-region>
      <div className="onboarding-card">
        <img className="onboarding-icon" src="/app-icon.png" alt="" width={72} height={72} />
        <h1>Verbinde deinen API-Key</h1>
        <p>
          Gespräche laufen über dein API-Guthaben, nicht über dein Claude-Abo. Der Key bleibt im Schlüsselbund deines
          Macs.
        </p>
        <KeyForm onSaved={onSaved} submitLabel="Verbinden" />
      </div>
    </div>
  );
}
