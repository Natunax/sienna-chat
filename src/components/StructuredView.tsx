import { useState } from "react";
import type { TemplateId } from "../api";
import { t, type TextKey } from "../i18n";
import { CheckIcon, CopyIcon } from "./icons";

// A template's answer arrives as data (see sidecar/templates.mjs) and is
// drawn here; anything unexpected in it is skipped rather than trusted.

type Severity = "high" | "medium" | "low";
const LEVELS: Record<Severity, TextKey> = { high: "template.high", medium: "template.medium", low: "template.low" };

const text = (value: unknown) => (typeof value === "string" ? value : "");
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object") : [];
const level = (value: unknown): Severity => (value === "high" || value === "low" ? value : "medium");

function toMarkdown(format: TemplateId, data: Record<string, unknown>): string {
  if (format === "changelog") {
    const sections = list(data.sections).map(
      (section) =>
        `### ${text(section.heading)}\n\n${(Array.isArray(section.items) ? section.items : []).map((item) => `- ${text(item)}`).join("\n")}`,
    );
    return [`## ${text(data.title)}`, ...sections].join("\n\n");
  }
  if (format === "review") {
    const findings = list(data.findings).map((finding) => {
      const where = `${text(finding.file)}${typeof finding.line === "number" ? `:${finding.line}` : ""}`;
      const fix = text(finding.fix) ? `\n  ${text(finding.fix)}` : "";
      return `- **${t(LEVELS[level(finding.severity)])}** \`${where}\`: ${text(finding.issue)}${fix}`;
    });
    return [text(data.summary), ...findings].join("\n\n");
  }
  return list(data.tasks)
    .map((task) => `- [ ] ${text(task.title)} (${t(LEVELS[level(task.priority)])})${text(task.detail) ? `: ${text(task.detail)}` : ""}`)
    .join("\n");
}

export function StructuredView({ format, data }: { format: TemplateId; data: unknown }) {
  const [copied, setCopied] = useState(false);
  const value = data && typeof data === "object" ? (data as Record<string, unknown>) : {};

  const copy = () =>
    void navigator.clipboard.writeText(toMarkdown(format, value)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });

  let body;
  if (format === "changelog") {
    const sections = list(value.sections);
    body = (
      <>
        {text(value.title) && <h3 className="structured-title">{text(value.title)}</h3>}
        {sections.map((section, index) => (
          <section key={index} className="structured-section">
            <h4>{text(section.heading)}</h4>
            <ul>
              {(Array.isArray(section.items) ? section.items : []).map((item, position) => (
                <li key={position}>{text(item)}</li>
              ))}
            </ul>
          </section>
        ))}
        {!sections.length && <p className="structured-empty">{t("template.empty")}</p>}
      </>
    );
  } else if (format === "review") {
    const findings = list(value.findings);
    body = (
      <>
        {text(value.summary) && <p className="structured-summary">{text(value.summary)}</p>}
        <ul className="structured-findings">
          {findings.map((finding, index) => (
            <li key={index} className="finding">
              <span className={`severity is-${level(finding.severity)}`}>{t(LEVELS[level(finding.severity)])}</span>
              <div className="finding-body">
                <code className="finding-where">
                  {text(finding.file)}
                  {typeof finding.line === "number" ? `:${finding.line}` : ""}
                </code>
                <p>{text(finding.issue)}</p>
                {text(finding.fix) && <p className="finding-fix">{text(finding.fix)}</p>}
              </div>
            </li>
          ))}
        </ul>
        {!findings.length && <p className="structured-empty">{t("template.empty")}</p>}
      </>
    );
  } else {
    const tasks = list(value.tasks);
    body = (
      <>
        <ul className="structured-tasks">
          {tasks.map((task, index) => (
            <li key={index}>
              <span className={`severity is-${level(task.priority)}`}>{t(LEVELS[level(task.priority)])}</span>
              <div>
                <p className="task-title">{text(task.title)}</p>
                {text(task.detail) && <p className="task-detail">{text(task.detail)}</p>}
              </div>
            </li>
          ))}
        </ul>
        {!tasks.length && <p className="structured-empty">{t("template.empty")}</p>}
      </>
    );
  }

  return (
    <div className="structured">
      {body}
      <button type="button" className="structured-copy" onClick={copy}>
        {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
        {t("template.copy")}
      </button>
    </div>
  );
}
