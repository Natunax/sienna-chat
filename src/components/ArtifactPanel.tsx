import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Artifact } from "../api";
import { errorText, t } from "../i18n";
import { loadHighlighter } from "../markdown";
import { ArtifactIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, DownloadIcon } from "./icons";
import { CopyButton, Markdown } from "./MessageView";

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
function SealedFrame({ artifact }: { artifact: Artifact }) {
  const [src, setSrc] = useState<string | null>(null);
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
    <iframe
      className="artifact-frame"
      title={artifact.title}
      // Scripts run, but in an opaque origin: no app, no storage, no top navigation, no pop-ups.
      sandbox="allow-scripts"
      src={preview ? undefined : `artifact://localhost/${src}`}
      srcDoc={preview ? src.slice(5) : undefined}
      referrerPolicy="no-referrer"
    />
  );
}

function CodeView({ artifact }: { artifact: Artifact }) {
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
  const showing = previewable ? view : "source";

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
    if (showing === "source") return <CodeView artifact={artifact} />;
    if (artifact.kind === "markdown") {
      return (
        <div className="artifact-document markdown">
          <Markdown text={artifact.content} final />
        </div>
      );
    }
    return <SealedFrame artifact={artifact} />;
  }, [showing, artifact]);

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
      <div className="artifact-body">{body}</div>
    </aside>
  );
}
