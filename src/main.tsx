import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  const { installDevMock, openDemoChat } = await import("./devMock");
  installDevMock();
  openDemoChat();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
