import { locale, t } from "../i18n";

/** Token counts in a short form: 950, 12.3k, 200k, 1M. */
function short(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`;
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}k`;
  if (tokens >= 1000) return `${Number((tokens / 1000).toFixed(1))}k`;
  return String(tokens);
}

/** How full the chat's context window is: a small ring and the token counts. */
export function ContextMeter({ used, window }: { used: number; window: number }) {
  const ratio = Math.min(1, used / window);
  const percent = Math.round(ratio * 100);
  const radius = 5.5;
  const circumference = 2 * Math.PI * radius;
  const exact = new Intl.NumberFormat(locale());
  const hint = t("composer.context", { percent, used: exact.format(used), window: exact.format(window) });

  return (
    <span className={`context-meter${ratio >= 0.8 ? " is-high" : ""}`} title={hint} aria-label={hint} role="img">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle className="context-track" cx="7" cy="7" r={radius} />
        <circle
          className="context-fill"
          cx="7"
          cy="7"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
        />
      </svg>
      <span className="context-figures">
        {short(used)} / {short(window)}
      </span>
    </span>
  );
}
