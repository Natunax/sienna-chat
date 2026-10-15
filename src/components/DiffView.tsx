import { useMemo } from "react";
import { diffLines, withContext, type DiffRow } from "../diff";
import { t } from "../i18n";

// Long changes show their start; the rest is a count.
const MAX_ROWS = 400;

interface Props {
  before: string;
  after: string;
  /** Line numbers only mean something for whole files, not for an Edit's snippet. */
  numbered: boolean;
}

function Row({ row, numbered }: { row: DiffRow; numbered: boolean }) {
  if (row.kind === "gap") {
    return <div className="diff-gap">{t("diff.unchanged", { count: row.count })}</div>;
  }
  const sign = row.kind === "add" ? "+" : row.kind === "remove" ? "−" : " ";
  return (
    <div className={`diff-line is-${row.kind}`}>
      {numbered && <span className="diff-no">{row.kind === "add" ? "" : row.old}</span>}
      {numbered && <span className="diff-no">{row.kind === "remove" ? "" : row.new}</span>}
      <span className="diff-sign" aria-hidden="true">
        {sign}
      </span>
      <span className="diff-text">{row.text || " "}</span>
    </div>
  );
}

/** A change as `git diff` shows it: removed and added lines with a little context. */
export function DiffView({ before, after, numbered }: Props) {
  const rows = useMemo(() => withContext(diffLines(before, after)), [before, after]);
  if (!rows.length) return <div className="diff diff-empty">{t("diff.empty")}</div>;
  const shown = rows.slice(0, MAX_ROWS);
  return (
    <div className="diff">
      <div className="diff-body">
        {shown.map((row, index) => (
          <Row key={index} row={row} numbered={numbered} />
        ))}
      </div>
      {rows.length > shown.length && (
        <div className="diff-gap">{t("diff.more", { count: rows.length - shown.length })}</div>
      )}
    </div>
  );
}
