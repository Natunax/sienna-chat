import { removeQueued, steerNow, useQueue } from "../store";
import { t } from "../i18n";
import { CloseIcon, DocumentIcon } from "./icons";

/**
 * Messages written while Claude works, above the input field: each goes out
 * after the answer, or now into the running answer, or not at all.
 */
export function QueueList({ chatId, running }: { chatId: string; running: boolean }) {
  const queue = useQueue(chatId);
  if (!queue.length) return null;
  return (
    <ul className="queue" aria-label={t("queue.label")}>
      {queue.map((entry) => {
        const files = entry.attachments.length;
        // Into a running answer goes text only; files wait for its end.
        const blocked = running && (files > 0 || !entry.text.trim());
        return (
          <li key={entry.id} className="queue-item">
            <span className="queue-text" title={entry.text}>
              {entry.text || t(files === 1 ? "queue.files.one" : "queue.files.other", { n: files })}
            </span>
            {files > 0 && entry.text && (
              <span className="queue-files">
                <DocumentIcon size={12} />
                {files}
              </span>
            )}
            <button
              type="button"
              className="text-button queue-send"
              disabled={blocked}
              onClick={() => steerNow(chatId, entry.id)}
              title={blocked ? t("queue.filesOnlyAfter") : running ? t("queue.sendNowHint") : undefined}
            >
              {t(running ? "queue.sendNow" : "queue.send")}
            </button>
            <button
              type="button"
              className="icon-button queue-remove"
              onClick={() => removeQueued(chatId, entry.id)}
              aria-label={t("queue.remove")}
              title={t("queue.remove")}
            >
              <CloseIcon size={13} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
