import { openUrl } from "@tauri-apps/plugin-opener";
import { useState, type FormEvent } from "react";
import { api } from "../api";
import { errorText, t } from "../i18n";

const KEYS_URL = "https://platform.claude.com/settings/keys";

export function KeyForm({ onSaved, submitLabel }: { onSaved: () => void; submitLabel?: string }) {
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
        placeholder="sk-ant-…"
        value={key}
        onChange={(event) => setKey(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        aria-label={t("key.label")}
        autoFocus
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-row">
        <button type="button" className="link-button" onClick={() => void openUrl(KEYS_URL)}>
          {t("key.create")}
        </button>
        <button type="submit" className="primary-button" disabled={!key.trim() || saving}>
          {saving ? t("key.saving") : (submitLabel ?? t("key.save"))}
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
        <h1>{t("key.title")}</h1>
        <p>{t("key.text")}</p>
        <KeyForm onSaved={onSaved} submitLabel={t("key.connect")} />
      </div>
    </div>
  );
}
