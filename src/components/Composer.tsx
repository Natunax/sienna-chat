import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { type Effort, type ModelId, type OutgoingAttachment, type Project } from "../api";
import { addProject } from "../store";
import { PICKER_ACCEPT, readAttachment, TEXT_MEDIA_TYPE } from "../attachments";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { errorText, t } from "../i18n";
import { ModelMenu } from "./ModelMenu";
import { PlusMenu } from "./PlusMenu";
import {
  ArrowUpIcon,
  CloseIcon,
  DocumentIcon,
  FolderIcon,
  GlobeIcon,
  StopIcon,
} from "./icons";

export interface ComposerSettings {
  model: ModelId;
  effort: Effort;
  web: boolean;
}

interface Props {
  settings: ComposerSettings;
  onSettings: (change: Partial<ComposerSettings>) => void;
  streaming: boolean;
  onSend: (text: string, attachments: OutgoingAttachment[]) => void;
  onStop: () => void;
  autoFocusKey: string;
  pendingFiles: File[];
  onFilesTaken: () => void;
  /** The folder Claude may read in this chat, if any. */
  project: string | null;
  /** The folder is fixed once the chat has messages. */
  projectLocked: boolean;
  /** A picked folder becomes (or finds) a project; `null` takes the chat out of it. */
  onProject: (project: Project | null) => void;
}

function folderName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/** A short type label for a text file chip, such as RS, MD or CSV. */
function fileLabel(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(dot + 1) : "TXT").slice(0, 4).toUpperCase();
}

export function Composer(props: Props) {
  const { settings, onSettings, streaming, onSend, onStop, autoFocusKey, pendingFiles, onFilesTaken } = props;
  const { project, projectLocked, onProject } = props;
  const [text, setText] = useState("");
  const [files, setFiles] = useState<OutgoingAttachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    area.current?.focus();
  }, [autoFocusKey]);

  // The text box grows with its content, and again when the window width changes the wrapping.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [text]);

  const addFiles = async (list: File[]) => {
    setNotice(null);
    for (const file of list) {
      try {
        const read = await readAttachment(file);
        setFiles((current) => [...current, read]);
      } catch (reason) {
        setNotice(String(reason));
      }
    }
  };

  useEffect(() => {
    if (!pendingFiles.length) return;
    void addFiles(pendingFiles);
    onFilesTaken();
  }, [pendingFiles]);

  const pickProject = async () => {
    setNotice(null);
    const picked = await openDialog({ directory: true, multiple: false, title: t("composer.projectTitle") });
    if (typeof picked !== "string") return;
    try {
      onProject(await addProject(picked));
    } catch (reason) {
      setNotice(errorText(reason));
    }
  };

  const canSend = !streaming && (text.trim().length > 0 || files.length > 0);

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim(), files);
    files.forEach((file) => file.previewUrl && URL.revokeObjectURL(file.previewUrl));
    setText("");
    setFiles([]);
    setNotice(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(event.clipboardData.files);
    if (pasted.length) {
      event.preventDefault();
      void addFiles(pasted);
    }
  };

  const removeFile = (index: number) => {
    setFiles((current) => {
      const file = current[index];
      if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
      return current.filter((_, i) => i !== index);
    });
  };

  const chips = settings.web || project || files.length > 0;

  return (
    <div className="composer-wrap">
      <div className="composer">
        {chips && (
          <div className="composer-chips">
            {settings.web && (
              <span className="chip">
                <GlobeIcon size={14} />
                {t("composer.web")}
                <button
                  type="button"
                  className="chip-remove"
                  onClick={() => onSettings({ web: false })}
                  aria-label={t("composer.webOff")}
                  title={t("composer.webOff")}
                >
                  <CloseIcon size={11} />
                </button>
              </span>
            )}
            {project && (
              <span
                className="chip"
                title={t(projectLocked ? "composer.projectLocked" : "composer.projectActive", { name: folderName(project) })}
              >
                <FolderIcon size={14} />
                <span className="chip-text">{folderName(project)}</span>
                {!projectLocked && (
                  <button
                    type="button"
                    className="chip-remove"
                    onClick={() => onProject(null)}
                    aria-label={t("composer.projectRemove")}
                    title={t("composer.projectRemove")}
                  >
                    <CloseIcon size={11} />
                  </button>
                )}
              </span>
            )}
            {files.map((file, index) => (
              <span key={index} className="chip chip-file">
                {file.previewUrl ? (
                  <img src={file.previewUrl} alt="" />
                ) : file.mediaType === TEXT_MEDIA_TYPE ? (
                  <span className="chip-ext">{fileLabel(file.name)}</span>
                ) : (
                  <DocumentIcon size={14} />
                )}
                <span className="chip-text">{file.name}</span>
                <button
                  type="button"
                  className="chip-remove"
                  aria-label={t("composer.remove", { name: file.name })}
                  title={t("composer.remove", { name: file.name })}
                  onClick={() => removeFile(index)}
                >
                  <CloseIcon size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer-row">
          <PlusMenu
            web={settings.web}
            onWeb={() => onSettings({ web: !settings.web })}
            onAttach={() => picker.current?.click()}
            onProject={projectLocked ? undefined : () => void pickProject()}
          />
          <input
            ref={picker}
            type="file"
            hidden
            multiple
            accept={PICKER_ACCEPT}
            onChange={(event) => {
              void addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <textarea
            ref={area}
            className="composer-input"
            rows={1}
            placeholder={t("composer.placeholder")}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            aria-label={t("composer.label")}
          />
          {streaming ? (
            <button
              type="button"
              className="send-button is-stop"
              onClick={onStop}
              aria-label={t("composer.stop")}
              title={t("composer.stopHint")}
            >
              <StopIcon size={16} />
            </button>
          ) : (
            <button
              type="button"
              className="send-button"
              onClick={submit}
              disabled={!canSend}
              aria-label={t("composer.send")}
              title={t("composer.sendHint")}
            >
              <ArrowUpIcon size={16} />
            </button>
          )}
        </div>
        {notice && <div className="composer-notice">{notice}</div>}
      </div>
      {/* The model sits below the box, as in Claude Code. */}
      <div className="composer-footer">
        <ModelMenu model={settings.model} effort={settings.effort} onChange={onSettings} />
      </div>
    </div>
  );
}
