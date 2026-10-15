import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { CheckIcon, FolderIcon, GlobeIcon, PaperclipIcon, PencilIcon, PlusIcon } from "./icons";

interface Props {
  web: boolean;
  onWeb: () => void;
  onAttach: () => void;
  /** Missing once the chat has messages: the folder is fixed then. */
  onProject?: () => void;
  autoEdits: boolean;
  /** Only in project chats: let file changes run without asking. */
  onAutoEdits?: (on: boolean) => void;
}

/** The composer's + button: attach a file, pick a project folder, toggle web search and edits without asking. */
export function PlusMenu({ web, onWeb, onAttach, onProject, autoEdits, onAutoEdits }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        className="plus-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("composer.more")}
        title={t("composer.more")}
        onClick={() => setOpen(!open)}
      >
        <PlusIcon size={18} />
      </button>
      {open && (
        <div className="menu plus-menu" role="menu">
          <button type="button" role="menuitem" className="plus-item" onClick={run(onAttach)}>
            <PaperclipIcon size={15} />
            {t("composer.attach")}
          </button>
          {onProject && (
            <button type="button" role="menuitem" className="plus-item" onClick={run(onProject)}>
              <FolderIcon size={15} />
              {t("composer.projectTitle")}
            </button>
          )}
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={web}
            className="plus-item"
            onClick={run(onWeb)}
          >
            <GlobeIcon size={15} />
            {t("composer.web")}
            {web && <CheckIcon size={14} className="plus-check" />}
          </button>
          {onAutoEdits && (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={autoEdits}
              className="plus-item"
              title={t("permission.alwaysHint")}
              onClick={run(() => onAutoEdits(!autoEdits))}
            >
              <PencilIcon size={15} />
              {t("composer.autoEdits")}
              {autoEdits && <CheckIcon size={14} className="plus-check" />}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
