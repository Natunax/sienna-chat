import { useEffect, useRef, useState } from "react";
import { MODELS, type ModelId } from "../api";
import { t } from "../i18n";
import { CheckIcon, ChevronDownIcon, CloseIcon, CompareIcon } from "./icons";
import { useMenuFocus } from "./useMenuFocus";

interface Props {
  /** The chat's own model, which is not offered. */
  own: ModelId;
  model: ModelId;
  onChange: (model: ModelId | null) => void;
}

/** The chip of a comparison: names the second model, picks another one, or ends it. */
export function CompareChip({ own, model, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
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

  const name = MODELS.find((entry) => entry.id === model)?.name ?? "";
  return (
    <span className="chip menu-anchor" ref={ref}>
      <CompareIcon size={13} />
      <button
        ref={trigger}
        type="button"
        className="chip-text chip-button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("compare.pick")}
        onClick={() => setOpen(!open)}
      >
        {t("compare.chip", { model: name })}
        <ChevronDownIcon size={11} />
      </button>
      <button
        type="button"
        className="chip-remove"
        onClick={() => onChange(null)}
        aria-label={t("compare.off")}
        title={t("compare.off")}
      >
        <CloseIcon size={11} />
      </button>
      {open && (
        <div ref={menu} className="menu model-menu compare-menu" role="menu" aria-label={t("compare.pick")}>
          {MODELS.filter((entry) => entry.id !== own).map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitemradio"
              aria-checked={entry.id === model}
              className="model-item"
              onClick={() => {
                onChange(entry.id);
                setOpen(false);
              }}
            >
              <span className="model-check">{entry.id === model && <CheckIcon size={14} />}</span>
              {entry.name}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
