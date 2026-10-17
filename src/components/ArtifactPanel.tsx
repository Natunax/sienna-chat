import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Artifact } from "../api";
import { errorText, t } from "../i18n";
import { loadHighlighter } from "../markdown";
import { ArtifactIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, DownloadIcon, MinusIcon, PlusIcon } from "./icons";
import { CopyButton, Markdown } from "./MessageView";

/** Zoom steps of the preview and code, as in a browser. */
export const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
export const MIN_ZOOM = ZOOMS[0];
export const MAX_ZOOM = ZOOMS[ZOOMS.length - 1];
export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** The next zoom step up or down from any zoom, also one fit or fill chose. */
export function stepZoom(current: number, step: number): number {
  const next = step > 0 ? ZOOMS.find((entry) => entry > current + 0.001) : [...ZOOMS].reverse().find((entry) => entry < current - 0.001);
  return next ?? current;
}

/** The content's box in page pixels and the frame's view, as the page reports them. */
export type Size = { l: number; t: number; w: number; h: number; vw: number; vh: number; pl: number; pt: number };

/**
 * The zoom at which the content, with the page's own margin, reaches the
 * edges of a box `width` × `height`. Centered content only needs the page
 * margin around it; content against the left or top keeps its distance there
 * and gets the same on the other side; the far edge never ends up outside.
 */
export function fitZoom(mode: "fit" | "fill", measured: Size, width: number, height: number): number {
  const span = (start: number, length: number, view: number, margin: number) => {
    const centered = Math.abs(start - (view - start - length)) < 8;
    return Math.max(length + 2 * margin, centered ? 0 : 2 * start + length, start + length + margin);
  };
  const across = width / span(measured.l, measured.w, measured.vw, measured.pl);
  const down = height / span(measured.t, measured.h, measured.vh, measured.pt);
  return clampZoom(mode === "fit" ? Math.min(across, down) : across);
}

interface Props {
  /** Every version of the artifact, oldest first. */
  versions: Artifact[];
  /** The version shown; the newest when it is null. */
  version: number | null;
  onVersion: (version: number) => void;
  onClose: () => void;
}

/**
 * HTML and SVG run in a frame from Rust's `artifact:` scheme with their own
 * strict policy and no access to the app (`src-tauri/src/artifact.rs`).
 */
export function SealedFrame({ artifact, zoom, onSize }: { artifact: Artifact; zoom: number; onSize: (size: Size) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  // The page reports the size of its content (Rust adds the script); only two
  // numbers from this very frame are taken.
  const report = useRef(onSize);
  report.current = onSize;
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as Record<string, unknown> | null;
      if (data?.sienna !== "size") return;
      const keys = ["l", "t", "w", "h", "vw", "vh", "pl", "pt"] as const;
      const values = keys.map((key) => data[key]);
      if (!values.every((value) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 100_000)) return;
      const [l, t, w, h, vw, vh, pl, pt] = values as number[];
      if (w > 0 && h > 0 && vw > 0 && vh > 0) report.current({ l, t, w, h, vw, vh, pl: Math.max(0, pl), pt: Math.max(0, pt) });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const kind = artifact.kind === "svg" ? "svg" : "html";
  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    void api
      .artifactStage(kind, artifact.content)
      .then((token) => !cancelled && setSrc(token))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [kind, artifact.content]);
  if (!src) return <div className="artifact-frame" />;
  // The browser preview fakes the scheme and passes the page itself.
  const preview = src.startsWith("mock:");
  return (
    // A scaled frame keeps its unscaled layout size; the box clips it, so
    // zooming out leaves no empty area to scroll into.
    <div className="artifact-frame-box">
    <iframe
      ref={frame}
      className="artifact-frame"
      title={artifact.title}
      // Scripts run, but in an opaque origin: no app, no storage, no top navigation, no pop-ups.
      sandbox="allow-scripts"
      src={preview ? undefined : `artifact://localhost/${src}`}
      srcDoc={preview ? src.slice(5) : undefined}
      referrerPolicy="no-referrer"
      // The page is laid out at its zoomed size and scaled back to fill the panel.
      style={
        zoom === 1
          ? undefined
          : { width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})`, transformOrigin: "0 0" }
      }
    />
    </div>
  );
}

export function CodeView({ artifact }: { artifact: Artifact }) {
  const code = useRef<HTMLElement>(null);
  const language = artifact.kind === "code" ? artifact.language : artifact.kind === "markdown" ? "markdown" : artifact.kind === "svg" ? "xml" : "html";
  useEffect(() => {
    const element = code.current;
    if (!element) return;
    element.textContent = artifact.content;
    element.removeAttribute("data-highlighted");
    let cancelled = false;
    void loadHighlighter().then((hljs) => {
      if (cancelled || !element) return;
      if (language && hljs.getLanguage(language)) {
        element.className = `language-${language}`;
        hljs.highlightElement(element);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [artifact.content, language]);
  return (
    <pre className="artifact-code">
      <code ref={code} />
    </pre>
  );
}

/** An artifact next to the chat: preview or code, its versions, copy and save. */
export function ArtifactPanel({ versions, version, onVersion, onClose }: Props) {
  const index = version === null ? versions.length - 1 : Math.min(version, versions.length - 1);
  const artifact = versions[index];
  const previewable = artifact.kind !== "code";
  const [view, setView] = useState<"preview" | "source">("preview");
  const [saved, setSaved] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState<Size | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const showing = previewable ? view : "source";
  // A zoom by hand ends a fit still settling.
  const resetZoom = () => {
    fitting.current = null;
    setZoom(1);
  };
  // + and − go to the next step, also from a zoom that fit or fill chose.
  const zoomBy = (step: number) => {
    fitting.current = null;
    setZoom((current) => stepZoom(current, step));
  };

  /** The zoom at which the content, with the page's own margin, reaches the panel's edges. */
  const target = (mode: "fit" | "fill", measured: Size) => {
    const body = bodyRef.current;
    return body ? fitZoom(mode, measured, body.clientWidth, body.clientHeight) : null;
  };
  // A page that centers itself moves its content when the zoom changes the
  // view, so fit and fill check the new measurement a few times.
  const fitting = useRef<{ mode: "fit" | "fill"; left: number } | null>(null);
  const fitTo = (mode: "fit" | "fill") => {
    if (!size) return;
    const next = target(mode, size);
    if (next === null) return;
    fitting.current = { mode, left: 4 };
    setZoom(next);
  };
  useEffect(() => {
    const run = fitting.current;
    if (!run || !size) return;
    const next = target(run.mode, size);
    run.left -= 1;
    if (next === null || run.left <= 0 || Math.abs(next - zoom) / zoom < 0.01) {
      fitting.current = null;
      return;
    }
    setZoom(next);
  }, [size]);

  // ⌘+ / ⌘− / ⌘0 zoom the preview, as in a browser.
  const zoomable = showing === "preview";
  useEffect(() => {
    if (!zoomable) return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey || event.altKey || event.ctrlKey) return;
      if (event.key === "+" || event.key === "=") zoomBy(1);
      else if (event.key === "-") zoomBy(-1);
      else if (event.key === "0") resetZoom();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomable]);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(null), 1600);
    return () => clearTimeout(timer);
  }, [saved]);

  const save = () =>
    void api
      .artifactSave(artifact)
      .then((done) => done && setSaved(t("artifact.saved")))
      .catch((reason) => setSaved(errorText(reason)));

  const body = useMemo(() => {
    // Zoom is for the preview only; code stays at its normal size.
    if (showing === "source") return <CodeView artifact={artifact} />;
    if (artifact.kind === "markdown") {
      return (
        <div className="artifact-document markdown" style={{ zoom }}>
          <Markdown text={artifact.content} final />
        </div>
      );
    }
    return <SealedFrame artifact={artifact} zoom={zoom} onSize={setSize} />;
  }, [showing, artifact, zoom]);

  return (
    <aside className="artifact-panel" aria-label={t("artifact.label")}>
      <header className="artifact-head">
        <ArtifactIcon size={16} className="artifact-head-icon" />
        <h2 className="artifact-title" title={artifact.title}>
          {artifact.title}
        </h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t("artifact.close")} title={t("artifact.close")}>
          <CloseIcon />
        </button>
      </header>
      <div className="artifact-bar">
        {previewable ? (
          <div className="segmented artifact-views" role="group">
            <button type="button" aria-pressed={showing === "preview"} className={showing === "preview" ? "is-active" : undefined} onClick={() => setView("preview")}>
              {t("artifact.preview")}
            </button>
            <button type="button" aria-pressed={showing === "source"} className={showing === "source" ? "is-active" : undefined} onClick={() => setView("source")}>
              {t("artifact.source")}
            </button>
          </div>
        ) : (
          <span className="artifact-language">{artifact.language || t("artifact.code")}</span>
        )}
        {versions.length > 1 && (
          <div className="artifact-versions">
            <button type="button" className="icon-button" disabled={index === 0} onClick={() => onVersion(index - 1)} aria-label={t("artifact.older")} title={t("artifact.older")}>
              <ChevronLeftIcon size={15} />
            </button>
            <span className="artifact-version">{t("artifact.version", { n: index + 1, total: versions.length })}</span>
            <button type="button" className="icon-button" disabled={index === versions.length - 1} onClick={() => onVersion(index + 1)} aria-label={t("artifact.newer")} title={t("artifact.newer")}>
              <ChevronRightIcon size={15} />
            </button>
          </div>
        )}
        <div className="artifact-actions">
          {zoomable && (
          <div className="artifact-zoom-control" role="group" aria-label={t("artifact.zoom")}>
            {size && artifact.kind !== "markdown" && (
              <>
                <button type="button" className="artifact-fit" onClick={() => fitTo("fit")} title={t("artifact.fitHint")}>
                  {t("artifact.fit")}
                </button>
                <button type="button" className="artifact-fit" onClick={() => fitTo("fill")} title={t("artifact.fillHint")}>
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
          {saved && (
            <span className="artifact-status" role="status">
              {saved}
            </span>
          )}
          <CopyButton text={artifact.content} />
          <button type="button" className="msg-action" onClick={save} aria-label={t("artifact.save")} title={t("artifact.save")}>
            <DownloadIcon size={15} />
          </button>
        </div>
      </div>
      <div className="artifact-body" ref={bodyRef}>
        {body}
      </div>
    </aside>
  );
}
