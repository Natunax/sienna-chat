import { useMemo } from "react";
import type { PermissionDecision, PermissionRequest } from "../api";
import { diffLines, diffStats } from "../diff";
import { t, type TextKey } from "../i18n";
import { DiffView } from "./DiffView";
import { DocumentIcon, PencilIcon, TerminalIcon } from "./icons";

interface Props {
  request: PermissionRequest;
  onAnswer: (request: PermissionRequest, decision: PermissionDecision) => void;
}

function title(request: PermissionRequest): string {
  if (!["Edit", "Write", "Bash"].includes(request.tool)) return t("permission.other", { tool: request.tool });
  return t(titleKey(request));
}

function titleKey(request: PermissionRequest): TextKey {
  if (request.tool === "Bash") return "permission.bash";
  if (request.tool === "Edit") return "permission.edit";
  return request.created ? "permission.create" : "permission.overwrite";
}

/** A change or command Claude waits to run, with the user's three answers. */
export function PermissionCard({ request, onAnswer }: Props) {
  // Bash, and any other tool, show their command or input as text.
  const command = request.tool !== "Edit" && request.tool !== "Write";
  const before = request.before ?? "";
  const after = request.after ?? "";
  const stats = useMemo(
    () => (command ? null : diffStats(diffLines(before, after))),
    [command, before, after],
  );
  const Icon = command
    ? TerminalIcon
    : request.tool === "Edit"
      ? PencilIcon
      : DocumentIcon;

  return (
    <section className="permission" aria-label={title(request)}>
      <header className="permission-head">
        <Icon size={15} className="permission-icon" />
        <span className="permission-title">{title(request)}</span>
        {stats && (
          <span className="permission-stats">
            <span className="is-add">+{stats.added}</span>
            <span className="is-remove">−{stats.removed}</span>
          </span>
        )}
      </header>
      {command ? (
        <div className="permission-body">
          {request.description && (
            <p className="permission-text">{request.description}</p>
          )}
          <pre className="permission-command">
            <code>{request.command}</code>
          </pre>
        </div>
      ) : (
        <div className="permission-body">
          <div className="permission-path">{request.path}</div>
          <DiffView
            before={before}
            after={after}
            numbered={request.tool === "Write"}
          />
          {request.replaceAll && (
            <p className="permission-text">{t("permission.replaceAll")}</p>
          )}
        </div>
      )}
      <footer className="permission-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => onAnswer(request, "deny")}
        >
          {t("permission.deny")}
        </button>
        <span className="permission-grant">
          {!command && (
            <button
              type="button"
              className="secondary-button"
              title={t("permission.alwaysHint")}
              onClick={() => onAnswer(request, "always")}
            >
              {t("permission.always")}
            </button>
          )}
          <button
            type="button"
            className="primary-button"
            onClick={() => onAnswer(request, "allow")}
          >
            {t("permission.allow")}
          </button>
        </span>
      </footer>
    </section>
  );
}
