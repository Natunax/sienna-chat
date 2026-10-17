import { useEffect, useMemo, useRef, useState } from "react";
import { type Artifact } from "../api";
import { t } from "../i18n";
import { CodeView, fitZoom, MAX_ZOOM, MIN_ZOOM, SealedFrame, stepZoom, type Size } from "./ArtifactPanel";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, CompareIcon, MinusIcon, PlusIcon } from "./icons";
import { Markdown, formatDuration } from "./MessageView";

export interface CompareSide {
  /** The model that made it. */
  model: string;
  durationMs?: number;
  /** Every version of its artifact, oldest first. */
  versions: Artifact[];
  /** The version shown at first. */
  start: number;
}

/** One side: whose it is, which version, and the artifact itself. */
function Side({
  side,
  index,
  onIndex,
  view,
  zoom,
  onSize,
  bodyRef,
}: {
  side: CompareSide;
  index: number;
  onIndex: (index: number) => void;
  view: "preview" | "source";
  zoom: number;
  onSize: (size: Size) => void;
  bodyRef: (element: HTMLDivElement | null) => void;
}) {
  const artifact = side.versions[index];
  const previewable = artifact.kind !== "code";
  const showing = previewable ? view : "source";
  return (
    <section className="compare-side" aria-label={side.model}>
      <header className="compare-side-head">
        <span className="compare-side-model">{side.model}</span>
        {side.durationMs !== undefined && <span className="compare-side-time">{formatDuration(side.durationMs)}</span>}
        <span className="compare-side-title" title={artifact.title}>
          {artifact.title}
        </span>
        {side.versions.length > 1 && (
          <span className="artifact-versions">
            <button type="button" className="icon-button" disabled={index === 0} onClick={() => onIndex(index - 1)} aria-label={t("artifact.older")} title={t("artifact.older")}>
              <ChevronLeftIcon size={14} />
            </button>
            <span className="artifact-version">{t("artifact.version", { n: index + 1, total: side.versions.length })}</span>
            <button type="button" className="icon-button" disabled={index === side.versions.length - 1} onClick={() => onIndex(index + 1)} aria-label={t("artifact.newer")} title={t("artifact.newer")}>
              <ChevronRightIcon size={14} />
            </button>
          </span>
        )}
      </header>
      <div className="compare-side-body" ref={bodyRef}>
        {showing === "source" ? (
          <CodeView artifact={artifact} />
        ) : artifact.kind === "markdown" ? (
          <div className="artifact-document markdown" style={{ zoom }}>
            <Markdown text={artifact.content} final />
          </div>
        ) : (
          <SealedFrame artifact={artifact} zoom={zoom} onSize={onSize} />
        )}
      </div>
    </section>
  );
}

/**
 * Two models' artifacts side by side, over the whole chat: one toolbar for
 * both, so preview, code, zoom, fit and fill always match and the designs
 * compare at the same scale.
 */
export function ArtifactCompare({ sides, onClose }: { sides: [CompareSide, CompareSide]; onClose: () => void }) {
  const [indexes, setIndexes] = useState<[number, number]>([sides[0].start, sides[1].start]);
  const [view, setView] = useState<"preview" | "source">("preview");
  const [zoom, setZoom] = useState(1);
  const [sizes, setSizes] = useState<[Size | null, Size | null]>([null, null]);
  const bodies = useRef<[HTMLDivElement | null, HTMLDivElement | null]>([null, null]);
  const root = useRef<HTMLElement>(null);
  const fitting = useRef<{ mode: "fit" | "fill"; left: number } | null>(null);

  const artifacts = [sides[0].versions[indexes[0]], sides[1].versions[indexes[1]]];
  const previewable = artifacts.some((artifact) => artifact.kind !== "code");
  const zoomable = view === "preview" && previewable;
  const measurable = artifacts.every((artifact) => artifact.kind === "html" || artifact.kind === "svg");

  // Both at the same scale: the side that needs the smaller zoom decides.
  const target = (mode: "fit" | "fill", measured: [Size | null, Size | null]) => {
    const zooms = measured.flatMap((size, at) => {
      const body = bodies.current[at];
      return size && body ? [fitZoom(mode, size, body.clientWidth, body.clientHeight)] : [];
    });
    return zooms.length === 2 ? Math.min(...zooms) : null;
  };
  const fitTo = (mode: "fit" | "fill") => {
    const next = target(mode, sizes);
    if (next === null) return;
    fitting.current = { mode, left: 4 };
    setZoom(next);
  };
  useEffect(() => {
    const run = fitting.current;
    if (!run) return;
    const next = target(run.mode, sizes);
    run.left -= 1;
    if (next === null || run.left <= 0 || Math.abs(next - zoom) / zoom < 0.01) {
      fitting.current = null;
      return;
    }
    setZoom(next);
  }, [sizes]);

  const zoomBy = (step: number) => {
    fitting.current = null;
    setZoom((current) => stepZoom(current, step));
  };
  const resetZoom = () => {
    fitting.current = null;
    setZoom(1);
  };

  // Esc closes; ⌘+ / ⌘− / ⌘0 zoom both previews.
  useEffect(() => {
    root.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (!event.metaKey || event.altKey || event.ctrlKey) return;
      if (event.key === "+" || event.key === "=") zoomBy(1);
      else if (event.key === "-") zoomBy(-1);
      else if (event.key === "0") resetZoom();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sideViews = useMemo(
    () =>
      sides.map((side, at) => (
        <Side
          key={at}
          side={side}
          index={indexes[at]}
          onIndex={(index) => setIndexes((current) => (at === 0 ? [index, current[1]] : [current[0], index]))}
          view={view}
          zoom={zoom}
          onSize={(size) => setSizes((current) => (at === 0 ? [size, current[1]] : [current[0], size]))}
          bodyRef={(element) => {
            bodies.current[at] = element;
          }}
        />
      )),
    [sides, indexes, view, zoom],
  );

  return (
    <section className="artifact-compare" ref={root} tabIndex={-1} aria-label={t("compareArtifacts.title")}>
      <header className="artifact-compare-head" data-tauri-drag-region>
        <CompareIcon size={16} className="artifact-head-icon" />
        <h2 className="artifact-title" data-tauri-drag-region>
          {t("compareArtifacts.title")}
        </h2>
        {previewable && (
          <div className="segmented artifact-views" role="group">
            <button type="button" aria-pressed={view === "preview"} className={view === "preview" ? "is-active" : undefined} onClick={() => setView("preview")}>
              {t("artifact.preview")}
            </button>
            <button type="button" aria-pressed={view === "source"} className={view === "source" ? "is-active" : undefined} onClick={() => setView("source")}>
              {t("artifact.source")}
            </button>
          </div>
        )}
        {zoomable && (
          <div className="artifact-zoom-control" role="group" aria-label={t("artifact.zoom")}>
            {measurable && sizes[0] && sizes[1] && (
              <>
                <button type="button" className="artifact-fit" onClick={() => fitTo("fit")} title={t("compareArtifacts.fitHint")}>
                  {t("artifact.fit")}
                </button>
                <button type="button" className="artifact-fit" onClick={() => fitTo("fill")} title={t("compareArtifacts.fillHint")}>
                  {t("artifact.fill")}
                </button>
              </>
            )}
            <button type="button" className="icon-button" disabled={zoom <= MIN_ZOOM} onClick={() => zoomBy(-1)} aria-label={t("artifact.zoomOut")} title={`${t("artifact.zoomOut")} (⌘−)`}>
              <MinusIcon size={14} />
            </button>
            <button type="button" className="artifact-zoom-value" onClick={resetZoom} title={`${t("artifact.zoomReset")} (⌘0)`}>
              {Math.round(zoom * 100)} %
            </button>
            <button type="button" className="icon-button" disabled={zoom >= MAX_ZOOM} onClick={() => zoomBy(1)} aria-label={t("artifact.zoomIn")} title={`${t("artifact.zoomIn")} (⌘+)`}>
              <PlusIcon size={14} />
            </button>
          </div>
        )}
        <button type="button" className="icon-button" onClick={onClose} aria-label={t("compareArtifacts.close")} title={`${t("compareArtifacts.close")} (Esc)`}>
          <CloseIcon />
        </button>
      </header>
      <div className="artifact-compare-sides">{sideViews}</div>
    </section>
  );
}
