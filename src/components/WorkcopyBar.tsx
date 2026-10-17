import { useEffect, useState } from "react";
import { api, MODELS, type Message, type WorkcopyChange } from "../api";
import { errorText, t, type TextKey } from "../i18n";
import { finishWorkcopy } from "../store";
import { CheckIcon, FolderIcon } from "./icons";

const SHOWN = 8;

type Outcome = { applied: string[]; conflicts: string[] };

/**
 * Under a second model's answer in a project: what it changed in its working
 * copy, and the choice to take that over into the project or drop it. The
 * project stays as it is until the user takes something over.
 */
export function WorkcopyBar({ chatId, message }: { chatId: string; message: Message }) {
  const [changes, setChanges] = useState<WorkcopyChange[] | null>(null);
  const [allShown, setAllShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    if (!confirmDiscard) return;
    const timer = setTimeout(() => setConfirmDiscard(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmDiscard]);

  if (!message.laneDir || message.streaming) return null;
  const model = MODELS.find((entry) => entry.id === message.model)?.name ?? message.model ?? "";
  const title = t("workcopy.titleOf", { model });

  const files = (n: number) => t(n === 1 ? "workcopy.fileOne" : "workcopy.fileOther", { n });

  if (message.laneDone) {
    return (
      <div className="workcopy is-done" role="status">
        <CheckIcon size={14} />
        <span>
          {outcome?.applied.length
            ? t("workcopy.applied", { files: files(outcome.applied.length) })
            : t(message.laneDone === "applied" ? "workcopy.appliedShort" : "workcopy.discarded")}
        </span>
      </div>
    );
  }

  const run = async (work: () => Promise<Outcome | null>) => {
    setBusy(true);
    setError(null);
    try {
      const done = await work();
      if (done) {
        // Already taken over earlier stays counted.
        setOutcome((before) => ({ applied: [...(before?.applied ?? []), ...done.applied], conflicts: done.conflicts }));
      }
    } catch (reason) {
      setError(errorText(reason));
    }
    setBusy(false);
  };
  const look = () =>
    run(async () => {
      setChanges(await api.workcopyChanges(message.laneDir!));
      return null;
    });
  const take = (force: string[] = []) => run(() => finishWorkcopy(chatId, message.id, true, force));
  const discard = () => run(() => finishWorkcopy(chatId, message.id, false));

  const kind = (entry: WorkcopyChange) => t(`workcopy.${entry.kind}` as TextKey);
  const listed = changes && (allShown ? changes : changes.slice(0, SHOWN));

  return (
    <div className="workcopy">
      <div className="workcopy-head">
        <FolderIcon size={14} />
        <span className="workcopy-title">{title}</span>
        {changes === null ? (
          <button type="button" className="secondary-button" onClick={() => void look()} disabled={busy}>
            {t("workcopy.look")}
          </button>
        ) : (
          <span className="workcopy-count">{changes.length ? files(changes.length) : t("workcopy.none")}</span>
        )}
      </div>
      {!outcome && <p className="workcopy-hint">{t("workcopy.untouched")}</p>}
      {error && <p className="workcopy-error">{error}</p>}

      {outcome ? (
        // Some files were left out: what went in, what did not, and the choice.
        <>
          {outcome.applied.length > 0 && (
            <p className="workcopy-result">
              <CheckIcon size={13} />
              {t("workcopy.applied", { files: files(outcome.applied.length) })}
            </p>
          )}
          <p className="workcopy-warning">{t("workcopy.leftOut")}</p>
          <ul className="workcopy-files">
            {outcome.conflicts.map((path) => (
              <li key={path}>
                <span className="workcopy-path" title={path}>
                  {path}
                </span>
              </li>
            ))}
          </ul>
          <div className="workcopy-actions">
            <button type="button" className="secondary-button" onClick={() => void discard()} disabled={busy}>
              {t("workcopy.keepProject")}
            </button>
            <button type="button" className="primary-button" onClick={() => void take(outcome.conflicts)} disabled={busy}>
              {t("workcopy.replace")}
            </button>
          </div>
        </>
      ) : (
        changes !== null && (
          <>
            {changes.length > 0 && listed && (
              <ul className="workcopy-files">
                {listed.map((entry) => (
                  <li key={entry.path}>
                    <span className={`workcopy-kind is-${entry.kind}`}>{kind(entry)}</span>
                    <span className="workcopy-path" title={entry.path}>
                      {entry.path}
                    </span>
                  </li>
                ))}
                {changes.length > SHOWN && !allShown && (
                  <li>
                    <button type="button" className="link-button workcopy-more" onClick={() => setAllShown(true)}>
                      {t("workcopy.more", { n: changes.length - SHOWN })}
                    </button>
                  </li>
                )}
              </ul>
            )}
            <div className="workcopy-actions">
              {/* Dropping the copy cannot be undone, so it asks once more. */}
              <button
                type="button"
                className={`secondary-button${confirmDiscard ? " is-danger is-confirming" : ""}`}
                onClick={() => (confirmDiscard ? void discard() : setConfirmDiscard(true))}
                disabled={busy}
              >
                {t(confirmDiscard ? "workcopy.discardConfirm" : "workcopy.discard")}
              </button>
              {changes.length > 0 && (
                <button type="button" className="primary-button" onClick={() => void take()} disabled={busy}>
                  {t("workcopy.apply")}
                </button>
              )}
            </div>
          </>
        )
      )}
    </div>
  );
}
