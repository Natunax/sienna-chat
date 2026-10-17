import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { useMenuFocus } from "./useMenuFocus";
import { CheckIcon, CompareIcon, FolderIcon, GlobeIcon, ListIcon, PaperclipIcon, PlusIcon, ShieldCheckIcon } from "./icons";

interface Props {
  web: boolean;
  onWeb: () => void;
  onAttach: () => void;
  /** Missing once the chat has messages: the folder is fixed then. */
  onProject?: () => void;
  comparing: boolean;
  onCompare: () => void;
  /** Only in project chats: the command run after changes. */
  onCheck?: () => void;
  /** All templates; one that cannot run here says why and stays disabled. */
  templates: { id: string; name: string; blocked: string | null; run: () => void }[];
  /** After a choice, typing goes on in the input field. */
  onDone: () => void;
}

/** The composer's + button: files, project folder, web search, comparing, checks and templates. */
export function PlusMenu({ web, onWeb, onAttach, onProject, comparing, onCompare, onCheck, templates, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useMenuFocus(open, menu, trigger);

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

  // Focus moves on before the menu closes, so it does not fall back to the + button.
  const run = (action: () => void) => () => {
    onDone();
    setOpen(false);
    action();
  };

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        ref={trigger}
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
        <div ref={menu} className="menu plus-menu" role="menu" aria-label={t("composer.more")}>
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
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={comparing}
            className="plus-item"
            onClick={run(onCompare)}
          >
            <CompareIcon size={15} />
            {t("compare.action")}
            {comparing && <CheckIcon size={14} className="plus-check" />}
          </button>
          {onCheck && (
            <button type="button" role="menuitem" className="plus-item" onClick={run(onCheck)}>
              <ShieldCheckIcon size={15} />
              {t("check.action")}
            </button>
          )}
          {templates.length > 0 && <div className="plus-heading">{t("template.title")}</div>}
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              role="menuitem"
              className="plus-item"
              // Still reachable by arrows and read out, with the reason it cannot run here.
              aria-disabled={Boolean(template.blocked)}
              title={template.blocked ?? undefined}
              onClick={template.blocked ? undefined : run(template.run)}
            >
              <ListIcon size={15} />
              <span className="plus-text">
                <span className="plus-name">{template.name}</span>
                {template.blocked && <span className="plus-reason">{template.blocked}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
