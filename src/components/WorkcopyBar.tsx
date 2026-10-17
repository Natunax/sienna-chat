import { useState } from "react";
import { api, type Message, type WorkcopyChange } from "../api";
import { errorText, t, type TextKey } from "../i18n";
import { finishWorkcopy } from "../store";
import { FolderIcon } from "./icons";

const SHOWN = 8;

/**
 * Under a second model's answer in a project: what it changed in its working
 * copy, and the choice to take that over into the project or drop it.
 */
export function WorkcopyBar({ chatId, message }: { chatId: string; message: Message }) {
  const [changes, setChanges] = useState<WorkcopyChange[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);

  if (!message.laneDir || message.streaming) return null;

  if (message.laneDone) {
    return (
      <div className="workcopy is-done" role="status">
        <FolderIcon size={14} />
        <span>{result ?? t(message.laneDone === "applied" ? "workcopy.appliedShort" : "workcopy.discarded")}</span>
        {conflicts.length > 0 && (
          <span className="workcopy-conflicts">{t("workcopy.conflicts", { files: conflicts.join(", ") })}</span>
        )}
      </div>
    );
  }

  const look = async () => {
    setBusy(true);
    try {
      setChanges(await api.workcopyChanges(message.laneDir!));
    } catch (reason) {
      setResult(errorText(reason));
    }
    setBusy(false);
  };

  const finish = async (take: boolean) => {
    setBusy(true);
    try {
      const done = await finishWorkcopy(chatId, message.id, take);
      if (done) {
        setResult(t("workcopy.applied", { n: done.applied.length }));
        setConflicts(done.conflicts);
      }
    } catch (reason) {
      setResult(errorText(reason));
    }
    setBusy(false);
  };

  const kind = (entry: WorkcopyChange) => t(`workcopy.${entry.kind}` as TextKey);

  return (
    <div className="workcopy">
      <div className="workcopy-head">
        <FolderIcon size={14} />
        <span className="workcopy-title">{t("workcopy.title")}</span>
        {changes === null ? (
          <button type="button" className="secondary-button" onClick={() => void look()} disabled={busy}>
            {t("workcopy.look")}
          </button>
        ) : (
          <span className="workcopy-count">
            {changes.length ? t("workcopy.count", { n: changes.length }) : t("workcopy.none")}
          </span>
        )}
      </div>
      {result && <p className="workcopy-error">{result}</p>}
      {changes !== null && (
        <>
          {changes.length > 0 && (
            <ul className="workcopy-files">
              {changes.slice(0, SHOWN).map((entry) => (
                <li key={entry.path}>
                  <span className={`workcopy-kind is-${entry.kind}`}>{kind(entry)}</span>
                  <span className="workcopy-path" title={entry.path}>
                    {entry.path}
                  </span>
                </li>
              ))}
              {changes.length > SHOWN && <li className="workcopy-more">{t("workcopy.more", { n: changes.length - SHOWN })}</li>}
            </ul>
          )}
          <div className="workcopy-actions">
            <button type="button" className="secondary-button" onClick={() => void finish(false)} disabled={busy}>
              {t("workcopy.discard")}
            </button>
            {changes.length > 0 && (
              <button type="button" className="primary-button" onClick={() => void finish(true)} disabled={busy}>
                {t("workcopy.apply")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
