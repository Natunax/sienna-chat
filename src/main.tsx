import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api";
import { App } from "./App";
import { setLanguage } from "./i18n";
import "./styles.css";

let openDemo: (() => void) | undefined;
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  const { installDevMock, openDemoChat } = await import("./devMock");
  installDevMock();
  openDemo = openDemoChat;
}

// The interface follows the Mac's language, so it is set before the first render.
setLanguage(await api.appLanguage().catch(() => navigator.language));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
openDemo?.();
