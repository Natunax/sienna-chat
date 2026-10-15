import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import {
  api,
  MODELS,
  TEMPLATES,
  type Chat,
  type Effort,
  type ModelId,
  type OutgoingAttachment,
  type PermissionMode,
  type Project,
  type TemplateId,
} from "../api";
import { addProject } from "../store";
import { PICKER_ACCEPT, readAttachment, TEXT_MEDIA_TYPE } from "../attachments";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { errorText, t } from "../i18n";
import { ContextMeter } from "./ContextMeter";
import { ModeMenu } from "./ModeMenu";
import { ModelMenu } from "./ModelMenu";
import { PlusMenu } from "./PlusMenu";
import {
  ArrowUpIcon,
  CloseIcon,
  CompareIcon,
  DocumentIcon,
  ShieldCheckIcon,
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
  /** Context window use after the last answer, when known. */
  context?: Chat["context"];
  /** Missing until the chat has an answer, or while one streams. */
  onCompact?: () => void;
  compacting: boolean;
  mode: PermissionMode;
  /** Always shown, as in Claude Code; it takes effect once the chat has a project folder. */
  onMode: (mode: PermissionMode) => void;
  /** Each question also goes to this model. */
  compareModel: ModelId | null;
  onCompare: (model: ModelId | null) => void;
  /** The project's command after changes; `onCheck` is missing outside projects. */
  check: string | null;
  onCheck?: (command: string) => void;
  onTemplate: (id: TemplateId, text: string) => void;
  /** The chat has an answer, so templates about the conversation make sense. */
  conversation: boolean;
}

type TemplateState = {
  id: TemplateId;
  name: string;
  command: string;
  prompt: string;
  /** Why it cannot run here; null when it can. */
  blocked: string | null;
};

/** The text typed after a leading slash, while it is still one word. */
function slashQuery(text: string): string | null {
  const match = /^\/(\S*)$/.exec(text);
  return match ? match[1].toLowerCase() : null;
}

/** The model to compare with: the next one after `from`, never the chat's own. */
function otherModel(own: ModelId, from: ModelId | null): ModelId {
  const others = MODELS.filter((entry) => entry.id !== own);
  const at = from ? others.findIndex((entry) => entry.id === from) : -1;
  if (at < 0) return own === "claude-opus-5-5" ? "claude-sonnet-5-5" : "claude-opus-5-5";
  return others[(at + 1) % others.length].id;
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
  const { project, projectLocked, onProject, context, onCompact, compacting, mode, onMode } = props;
  const { compareModel, onCompare, check, onCheck, onTemplate, conversation } = props;
  const [slashActive, setSlashActive] = useState(0);
  const [slashClosed, setSlashClosed] = useState(false);
  const [checkDraft, setCheckDraft] = useState<string | null>(null);
  const comparing = compareModel && compareModel !== settings.model ? compareModel : null;

  const editCheck = async () => {
    let draft = check ?? "";
    if (!draft && project) draft = await api.projectGuessCheck(project).catch(() => "");
    setCheckDraft(draft);
  };
  const saveCheck = () => {
    if (checkDraft === null) return;
    onCheck?.(checkDraft.trim());
    setCheckDraft(null);
  };
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

  // One view of the templates for the + menu and the slash commands.
  const templates: TemplateState[] = TEMPLATES.map((entry) => {
    const outOfPlace = entry.project && !project;
    const early = entry.conversation && !conversation;
    return {
      id: entry.id,
      name: t(entry.name),
      command: t(entry.command),
      prompt: t(entry.prompt),
      blocked: outOfPlace ? t("slash.projectOnly") : early ? t("slash.afterAnswer") : streaming ? t("slash.busy") : null,
    };
  });
  const runTemplate = (template: TemplateState) => {
    if (template.blocked) return;
    onTemplate(template.id, template.prompt);
    setText("");
  };

  // Slash commands: a leading "/" and one word open the list above the input.
  const query = slashQuery(text);
  const matches =
    query === null
      ? []
      : templates.filter((template) => template.command.startsWith(query) || template.id.startsWith(query));
  const slashOpen = matches.length > 0 && !slashClosed;
  const active = Math.min(slashActive, matches.length - 1);

  // The first command that can run here is marked when the list opens or narrows.
  useEffect(() => {
    setSlashActive(Math.max(0, matches.findIndex((template) => !template.blocked)));
    if (query === null) setSlashClosed(false);
  }, [query]);

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
    if (slashOpen && !event.nativeEvent.isComposing) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setSlashActive((active + step + matches.length) % matches.length);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSlashClosed(true);
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        runTemplate(matches[active]);
        return;
      }
    }
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

  const chips = settings.web || project || comparing || (check && onCheck) || files.length > 0;

  return (
    <div className="composer-wrap">
      <div className="composer">
        {slashOpen && (
          <div className="slash-menu" role="listbox" id="slash-menu" aria-label={t("slash.label")}>
            {matches.map((template, index) => (
              <button
                key={template.id}
                type="button"
                role="option"
                id={`slash-${template.id}`}
                aria-selected={index === active}
                aria-disabled={Boolean(template.blocked)}
                className={`slash-item${index === active ? " is-active" : ""}${template.blocked ? " is-blocked" : ""}`}
                // The input keeps focus, so typing can go on.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setSlashActive(index)}
                onClick={() => runTemplate(template)}
              >
                <span className="slash-command">/{template.command}</span>
                <span className="slash-name">{template.name}</span>
                {template.blocked && <span className="slash-reason">{template.blocked}</span>}
              </button>
            ))}
          </div>
        )}
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
            {comparing && (
              <span className="chip">
                <CompareIcon size={13} />
                <button type="button" className="chip-text chip-button" onClick={() => onCompare(otherModel(settings.model, comparing))} title={t("compare.next")}>
                  {t("compare.chip", { model: MODELS.find((entry) => entry.id === comparing)?.name ?? "" })}
                </button>
                <button
                  type="button"
                  className="chip-remove"
                  onClick={() => onCompare(null)}
                  aria-label={t("compare.off")}
                  title={t("compare.off")}
                >
                  <CloseIcon size={11} />
                </button>
              </span>
            )}
            {check && onCheck && (
              <span className="chip">
                <ShieldCheckIcon size={13} />
                <button type="button" className="chip-text chip-button" onClick={() => void editCheck()} title={t("check.edit")}>
                  {t("check.chip", { command: check })}
                </button>
                <button
                  type="button"
                  className="chip-remove"
                  onClick={() => onCheck("")}
                  aria-label={t("check.off")}
                  title={t("check.off")}
                >
                  <CloseIcon size={11} />
                </button>
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
        {checkDraft !== null && (
          <form
            className="check-editor"
            onSubmit={(event) => {
              event.preventDefault();
              saveCheck();
            }}
          >
            <label className="check-label">
              <ShieldCheckIcon size={14} />
              <input
                className="check-input"
                value={checkDraft}
                onChange={(event) => setCheckDraft(event.target.value)}
                onKeyDown={(event) => event.key === "Escape" && setCheckDraft(null)}
                placeholder={t("check.placeholder")}
                aria-label={t("check.action")}
                spellCheck={false}
                maxLength={500}
                autoFocus
              />
            </label>
            <p className="check-hint">{t("check.hint")}</p>
            <div className="check-actions">
              <button type="button" className="secondary-button" onClick={() => setCheckDraft(null)}>
                {t("message.cancel")}
              </button>
              <button type="submit" className="primary-button">
                {t("check.save")}
              </button>
            </div>
          </form>
        )}
        <div className="composer-row">
          <PlusMenu
            web={settings.web}
            onWeb={() => onSettings({ web: !settings.web })}
            onAttach={() => picker.current?.click()}
            onProject={projectLocked ? undefined : () => void pickProject()}
            comparing={Boolean(comparing)}
            onCompare={() => onCompare(comparing ? null : otherModel(settings.model, null))}
            onCheck={project && onCheck ? () => void editCheck() : undefined}
            templates={templates.map((template) => ({
              id: template.id,
              name: template.name,
              blocked: template.blocked,
              run: () => runTemplate(template),
            }))}
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
            aria-controls={slashOpen ? "slash-menu" : undefined}
            aria-activedescendant={slashOpen ? `slash-${matches[active]?.id}` : undefined}
            aria-autocomplete="list"
          />
          {streaming ? (
            <button
              type="button"
              className="send-button is-stop"
              onClick={onStop}
              aria-label={t("composer.stop")}
              title={t("composer.stopHint")}
            >
              <StopIcon size={15} />
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
              <ArrowUpIcon size={15} />
            </button>
          )}
        </div>
        {notice && <div className="composer-notice">{notice}</div>}
      </div>
      {/* As in Claude Code: the mode on the left, model and context on the right. */}
      <div className="composer-footer">
        <ModeMenu mode={mode} onChange={onMode} />
        <div className="composer-footer-end">
          <ModelMenu model={settings.model} effort={settings.effort} onChange={onSettings} />
          {context && context.window > 0 && (
            <ContextMeter
              used={context.used}
              window={context.window}
              categories={context.categories}
              onCompact={onCompact}
              compacting={compacting}
            />
          )}
        </div>
      </div>
    </div>
  );
}
