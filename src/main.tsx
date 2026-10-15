import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api";
import { App } from "./App";
import { initLanguage } from "./i18n";
import "./styles.css";

let openDemo: (() => void) | undefined;
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  const { installDevMock, openDemoChat } = await import("./devMock");
  installDevMock();
  openDemo = openDemoChat;
}

// The interface follows the Mac's language unless the settings pin one; it is
// set before the first render.
initLanguage(await api.appLanguage().catch(() => navigator.language));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
openDemo?.();
