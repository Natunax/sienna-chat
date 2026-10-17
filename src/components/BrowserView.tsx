import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { api, type BrowserArea } from "../api";
import { errorText, t } from "../i18n";
import { useWindowCovered } from "../overlay";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, ExternalIcon, GlobeIcon, RetryIcon } from "./icons";

/** What the browser shows; one browser for the whole window, so it outlives a chat. */
interface Page {
  url: string;
  title: string;
  loading: boolean;
  /** The native view exists. */
  open: boolean;
}

let page: Page = { url: "", title: "", loading: false, open: false };
const listeners = new Set<() => void>();
function setPage(next: Partial<Page>) {
  page = { ...page, ...next };
  listeners.forEach((listener) => listener());
}
/** Whether a page is open in the browser, for the panel's width. */
export function useBrowserOpen(): boolean {
  return usePage().open;
}

function usePage(): Page {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => page,
  );
}

// Rust reports loads and titles of the page (browser.rs).
let listening = false;
function listenOnce() {
  if (listening) return;
  listening = true;
  void listen<{ url: string; loading: boolean }>("browser-nav", ({ payload }) =>
    setPage({ url: payload.url, loading: payload.loading, ...(payload.loading ? { title: "" } : {}) }),
  );
  void listen<string>("browser-title", ({ payload }) => setPage({ title: payload }));
}

/**
 * What was typed, as an address: a web address as it is, a bare host with
 * https (http for a local server), anything else as a search.
 */
export function toAddress(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(text)) return `http://${text}`;
  if (!/\s/.test(text) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(text)) return `https://${text}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
}

function areaOf(element: HTMLElement): BrowserArea {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

/**
 * A browser in the side panel. The page itself is a native view Rust lays
 * over the placeholder below the address bar; it hides whenever something
 * else must be seen there (another tab, a dialog, the artifact comparison).
 */
export function BrowserView({ covered }: { covered: boolean }) {
  const current = usePage();
  const [address, setAddress] = useState(current.url);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const dialog = useWindowCovered();
  const hidden = covered || dialog;

  useEffect(listenOnce, []);
  // The field follows the page unless the user is typing in it.
  useEffect(() => {
    if (!editing) setAddress(current.url);
  }, [current.url, editing]);

  // The native view follows the placeholder, and hides when this view goes.
  useEffect(() => {
    const element = host.current;
    if (!element || !current.open) return;
    if (hidden) {
      void api.browserVisible(false);
      return;
    }
    let frame = 0;
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void api.browserBounds(areaOf(element)));
    };
    place();
    void api.browserVisible(true);
    const observer = new ResizeObserver(place);
    observer.observe(element);
    observer.observe(document.documentElement);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", place);
      void api.browserVisible(false);
    };
  }, [current.open, hidden]);

  const go = async (event: FormEvent) => {
    event.preventDefault();
    const url = toAddress(address);
    if (!url || !host.current) return;
    setError(null);
    // Loading from here on; the page's own events take over (a fast page may finish first).
    setPage({ loading: true });
    try {
      await api.browserOpen(url, areaOf(host.current));
      // Unless the page already reported where it ended up.
      setPage(page.loading ? { open: true, url } : { open: true });
      setEditing(false);
      if (hidden) void api.browserVisible(false);
    } catch (problem) {
      // The typed address stays, with what went wrong under it.
      setPage({ loading: false });
      setError(errorText(problem));
    }
  };

  // A page that fails or turns into a download never reports its end.
  useEffect(() => {
    if (!current.loading) return;
    const timer = setTimeout(() => setPage({ loading: false }), 20_000);
    return () => clearTimeout(timer);
  }, [current.loading, current.url]);

  return (
    <section className="browser" aria-label={t("side.browser")}>
      <form className="browser-bar" onSubmit={go}>
        <button type="button" className="icon-button" disabled={!current.open} onClick={() => void api.browserGo("back")} aria-label={t("browser.back")} title={t("browser.back")}>
          <ChevronLeftIcon size={15} />
        </button>
        <button type="button" className="icon-button" disabled={!current.open} onClick={() => void api.browserGo("forward")} aria-label={t("browser.forward")} title={t("browser.forward")}>
          <ChevronRightIcon size={15} />
        </button>
        <button
          type="button"
          className="icon-button"
          disabled={!current.open}
          onClick={() => {
            if (current.loading) setPage({ loading: false });
            void api.browserGo(current.loading ? "stop" : "reload");
          }}
          aria-label={t(current.loading ? "browser.stop" : "browser.reload")}
          title={t(current.loading ? "browser.stop" : "browser.reload")}
        >
          {current.loading ? <CloseIcon size={14} /> : <RetryIcon size={14} />}
        </button>
        <input
          className="browser-address"
          value={address}
          onChange={(event) => {
            setEditing(true);
            setError(null);
            setAddress(event.target.value);
          }}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={() => !error && setEditing(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setEditing(false);
              setAddress(current.url);
              event.currentTarget.blur();
            }
          }}
          placeholder={t("browser.placeholder")}
          aria-label={t("browser.address")}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
        {/* Always in place, so the address field keeps its width. */}
        <button
          type="button"
          className="icon-button"
          disabled={!current.open}
          onClick={() => void openUrl(current.url)}
          aria-label={t("browser.external")}
          title={t("browser.external")}
        >
          <ExternalIcon size={15} />
        </button>
        {current.loading && <span className="browser-progress" aria-hidden="true" />}
      </form>
      {error && (
        <p className="browser-error" role="alert">
          {error}
        </p>
      )}
      <div className="browser-host" ref={host}>
        {!current.open && (
          <div className="side-empty">
            <span className="side-empty-icon">
              <GlobeIcon size={20} />
            </span>
            <p>{t("browser.empty")}</p>
          </div>
        )}
        {current.open && hidden && <div className="browser-paused">{current.title || current.url}</div>}
      </div>
    </section>
  );
}
