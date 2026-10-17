import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { t } from "../i18n";
import { coverWindow } from "../overlay";

/** A width the user dragged, remembered on this Mac; `null` keeps the layout's own. */
export function useStoredWidth(key: string): [number | null, (width: number | null) => void] {
  const storageKey = `sienna.width.${key}`;
  const [width, setWidth] = useState<number | null>(() => {
    try {
      const stored = Number(localStorage.getItem(storageKey));
      return stored > 0 ? stored : null;
    } catch {
      return null;
    }
  });
  const store = (next: number | null) => {
    setWidth(next);
    try {
      if (next === null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, String(Math.round(next)));
    } catch {
      // Not remembered, still applied.
    }
  };
  return [width, store];
}

interface Props {
  /** The edge the handle sits on, seen from the panel it resizes. */
  edge: "left" | "right";
  /** The panel's width now, measured when a drag starts. */
  measure: () => number;
  min: number;
  /** The most it may take, also measured when a drag starts. */
  max: () => number;
  onWidth: (width: number) => void;
  /** Double click: back to the layout's own width. */
  onReset: () => void;
  label: string;
}

/**
 * A border to drag, as in Finder's sidebar: wider or narrower, a double click
 * resets, and the arrow keys work too. While it drags, frames and the
 * browser's native view keep out of the way, so the pointer never gets lost.
 */
export function ResizeHandle({ edge, measure, min, max, onWidth, onReset, label }: Props) {
  const drag = useRef<{ x: number; width: number; max: number; uncover: () => void } | null>(null);
  const [active, setActive] = useState(false);
  const clamp = (width: number, most: number) => Math.round(Math.min(Math.max(width, min), Math.max(min, most)));
  // Dragging toward the panel shrinks it.
  const direction = edge === "right" ? 1 : -1;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width: measure(), max: max(), uncover: coverWindow() };
    document.documentElement.classList.add("is-resizing");
    setActive(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const run = drag.current;
    if (!run) return;
    onWidth(clamp(run.width + direction * (event.clientX - run.x), run.max));
  };
  const end = () => {
    drag.current?.uncover();
    drag.current = null;
    document.documentElement.classList.remove("is-resizing");
    setActive(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    const delta = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    if (!delta) return;
    event.preventDefault();
    onWidth(clamp(measure() + direction * delta, max()));
  };

  return (
    <div
      className={`resize-handle is-${edge}${active ? " is-active" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={`${label}\n${t("resize.hint")}`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
