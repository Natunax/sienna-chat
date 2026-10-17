import { useEffect, useRef, useState, type CSSProperties } from "react";
import { EFFORTS, MODELS, type Effort, type ModelId } from "../api";
import { t } from "../i18n";
import { useMenuFocus } from "./useMenuFocus";
import { AgentsIcon, CheckIcon, ChevronDownIcon } from "./icons";

interface Props {
  model: ModelId;
  effort: Effort;
  onChange: (change: { model?: ModelId; effort?: Effort }) => void;
}

function EffortSlider({ effort, onChange }: { effort: Effort; onChange: (effort: Effort) => void }) {
  const ultra = effort === "ultracode";
  // Ultracode works at the highest level; the slider shows it there.
  const level = ultra ? EFFORTS.length - 1 : Math.max(0, EFFORTS.findIndex((entry) => entry.id === effort));
  const name = ultra ? t("effort.ultracode") : t(EFFORTS[level].name);
  // The filled part of the track ends under the thumb's center (see styles.css).
  const ratio = { "--ratio": level / (EFFORTS.length - 1) } as CSSProperties;

  return (
    <div className={`effort${ultra ? " is-ultra" : ""}`}>
      <div className="effort-head">
        <span>{t("composer.effort")}</span>
        <span className="effort-value">{name}</span>
      </div>
      <div className="effort-track" style={ratio}>
        <input
          type="range"
          className="effort-range"
          min={0}
          max={EFFORTS.length - 1}
          step={1}
          value={level}
          onChange={(event) => onChange(EFFORTS[Number(event.target.value)].id)}
          // Under Ultracode the thumb already rests on Max: touching it there picks Max.
          onPointerUp={() => ultra && onChange("max")}
          onKeyUp={(event) => ultra && ["ArrowRight", "ArrowUp", "End"].includes(event.key) && onChange("max")}
          aria-label={t("composer.effort")}
          aria-valuetext={name}
        />
        <span className="effort-ticks" aria-hidden="true">
          {EFFORTS.map((entry) => (
            <span key={entry.id} />
          ))}
        </span>
      </div>
    </div>
  );
}

export function ModelMenu({ model, effort, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = MODELS.find((entry) => entry.id === model) ?? MODELS[1];
  const ultra = effort === "ultracode";
  const effortName = ultra ? t("effort.ultracode") : t((EFFORTS.find((entry) => entry.id === effort) ?? EFFORTS[1]).name);

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

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        ref={trigger}
        className="pill"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={t("composer.modelHint")}
      >
        {current.name}
        <span className={`pill-detail${ultra ? " is-ultra" : ""}`}>· {effortName}</span>
        <ChevronDownIcon size={13} />
      </button>
      {open && (
        <div ref={menu} className="menu model-menu" role="menu" aria-label={t("composer.modelHint")}>
          {MODELS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitemradio"
              aria-checked={entry.id === model}
              className="model-item"
              onClick={() => {
                onChange({ model: entry.id });
                setOpen(false);
              }}
            >
              <span className="model-check">{entry.id === model && <CheckIcon size={14} />}</span>
              {entry.name}
            </button>
          ))}
          <EffortSlider effort={effort} onChange={(next) => onChange({ effort: next })} />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={ultra}
            className="ultracode-item"
            onClick={() => onChange({ effort: ultra ? "max" : "ultracode" })}
          >
            <AgentsIcon size={16} />
            <span className="ultracode-name">{t("effort.ultracode")}</span>
            <span className="ultracode-hint">{t("effort.ultracodeHint")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
