import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { EFFORTS, MODELS, type Effort, type ModelId, type OutgoingAttachment } from "../api";
import { PICKER_ACCEPT, readAttachment, TEXT_MEDIA_TYPE } from "../attachments";
import { t } from "../i18n";
import { ArrowUpIcon, CheckIcon, ChevronDownIcon, CloseIcon, DocumentIcon, GlobeIcon, PaperclipIcon, StopIcon } from "./icons";

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
}

/** A short type label for a text file chip, such as RS, MD or CSV. */
function fileLabel(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(dot + 1) : "TXT").slice(0, 4).toUpperCase();
}

function ModelMenu({ settings, onSettings }: Pick<Props, "settings" | "onSettings">) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = MODELS.find((model) => model.id === settings.model) ?? MODELS[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => event.key === "Escape" && setOpen(false);
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
        className="pill"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={t("composer.modelHint")}
      >
        {current.name}
        <ChevronDownIcon size={13} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {MODELS.map((model) => (
            <button
              key={model.id}
              type="button"
              role="menuitemradio"
              aria-checked={model.id === settings.model}
              className="menu-item"
              onClick={() => {
                onSettings({ model: model.id });
                setOpen(false);
              }}
            >
              <span className="menu-text">
                <span className="menu-title">{model.name}</span>
                <span className="menu-hint">{t(model.hint)}</span>
              </span>
              {model.id === settings.model && <CheckIcon size={15} className="menu-check" />}
            </button>
          ))}
          <div className="menu-sep" />
          <div className="menu-label">{t("composer.effort")}</div>
          <div className="segmented" role="radiogroup" aria-label={t("composer.effort")}>
            {EFFORTS.map((effort) => (
              <button
                key={effort.id}
                type="button"
                role="radio"
                aria-checked={effort.id === settings.effort}
                className={effort.id === settings.effort ? "is-active" : undefined}
                onClick={() => onSettings({ effort: effort.id })}
              >
                {t(effort.name)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Composer(props: Props) {
  const { settings, onSettings, streaming, onSend, onStop, autoFocusKey, pendingFiles, onFilesTaken } = props;
  const [text, setText] = useState("");
  const [files, setFiles] = useState<OutgoingAttachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    area.current?.focus();
  }, [autoFocusKey]);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
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

  return (
    <div className="composer">
      {files.length > 0 && (
        <div className="composer-files">
          {files.map((file, index) => (
            <div key={index} className="attachment">
              {file.previewUrl ? (
                <img src={file.previewUrl} alt="" />
              ) : (
                <span className="attachment-doc">
                  {file.mediaType === TEXT_MEDIA_TYPE ? (
                    <span className="attachment-ext">{fileLabel(file.name)}</span>
                  ) : (
                    <DocumentIcon size={18} />
                  )}
                </span>
              )}
              <span className="attachment-name">{file.name}</span>
              <button
                type="button"
                className="attachment-remove"
                aria-label={t("composer.remove", { name: file.name })}
                onClick={() => removeFile(index)}
              >
                <CloseIcon size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
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
      {notice && <div className="composer-notice">{notice}</div>}
      <div className="composer-bar">
        <div className="composer-tools">
          <button
            type="button"
            className="icon-button"
            onClick={() => picker.current?.click()}
            aria-label={t("composer.attach")}
            title={t("composer.attachHint")}
          >
            <PaperclipIcon />
          </button>
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
          <button
            type="button"
            className={`pill${settings.web ? " is-on" : ""}`}
            aria-pressed={settings.web}
            onClick={() => onSettings({ web: !settings.web })}
            title={t("composer.webHint")}
          >
            <GlobeIcon size={15} />
            {t("composer.web")}
          </button>
          <ModelMenu settings={settings} onSettings={onSettings} />
        </div>
        {streaming ? (
          <button type="button" className="send-button is-stop" onClick={onStop} aria-label={t("composer.stop")} title={t("composer.stopHint")}>
            <StopIcon />
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
            <ArrowUpIcon />
          </button>
        )}
      </div>
    </div>
  );
}
