import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import { api, type Chat } from "./api";
import { ChatView } from "./components/ChatView";
import type { ComposerSettings } from "./components/Composer";
import { Onboarding } from "./components/KeyForm";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sidebar } from "./components/Sidebar";
import { errorText, t, useLanguage } from "./i18n";
import {
  createChat,
  deleteChat,
  getChat,
  loadChat,
  addProject,
  getProject,
  projectFor,
  refreshProjects,
  refreshSummaries,
  removeProject,
  renameChat,
  renameProject,
  useProjects,
  togglePin,
  refreshUsage,
  startEngineListener,
  useChat,
  useSummaries,
  useUsage,
} from "./store";

const PREFS_KEY = "chat-defaults";
const FALLBACK: ComposerSettings = { model: "claude-sonnet-5-5", effort: "medium", web: false };

function readDefaults(): ComposerSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
    return stored ? { ...FALLBACK, ...stored } : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

function writeDefaults(settings: ComposerSettings) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(settings));
  } catch {
    // Defaults are a convenience; the chat keeps its own settings.
  }
}

export function App() {
  // Re-render everything when the language is switched in the settings.
  useLanguage();
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  // The first chat exists from the first render on, so the window never shows an empty pane.
  const [activeId, setActiveId] = useState<string | null>(() => createChat(readDefaults()).id);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const summaries = useSummaries();
  const projects = useProjects();
  const [projectError, setProjectError] = useState<string | null>(null);
  const usage = useUsage();
  const chat = useChat(activeId);

  const newChat = useCallback(() => {
    const current = activeId ? getChat(activeId) : undefined;
    if (current && current.messages.length === 0) return;
    setActiveId(createChat(readDefaults()).id);
  }, [activeId]);

  /** A new chat in a project's folder; an empty one already open there is reused. */
  const newChatIn = useCallback(
    (projectId: string) => {
      const project = getProject(projectId);
      if (!project) return;
      const current = activeId ? getChat(activeId) : undefined;
      if (current && current.messages.length === 0 && current.projectId === projectId) return;
      setActiveId(createChat(readDefaults(), project).id);
    },
    [activeId],
  );

  const addProjectFromFolder = useCallback(async () => {
    setProjectError(null);
    const picked = await openDialog({ directory: true, multiple: false, title: t("sidebar.addProject") });
    if (typeof picked !== "string") return;
    try {
      const project = await addProject(picked);
      setActiveId(createChat(readDefaults(), project).id);
    } catch (reason) {
      setProjectError(errorText(reason));
    }
  }, []);

  const openChat = useCallback(async (id: string) => {
    try {
      const loaded: Chat = await loadChat(id);
      setActiveId(loaded.id);
    } catch {
      void refreshSummaries();
    }
  }, []);

  const removeChat = useCallback(
    async (id: string) => {
      await deleteChat(id).catch(() => {});
      if (id === activeId) setActiveId(createChat(readDefaults()).id);
    },
    [activeId],
  );

  useEffect(() => {
    startEngineListener();
    void api.keyStatus().then(setHasKey);
    void refreshSummaries();
    void refreshUsage();
    void refreshProjects();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey) return;
      if (event.key === "n") {
        event.preventDefault();
        newChat();
      } else if (event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
      } else if (event.key === "\\") {
        event.preventDefault();
        setSidebarOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newChat]);

  if (hasKey === null) return <div className="app-loading" data-tauri-drag-region />;
  if (!hasKey) return <Onboarding onSaved={() => setHasKey(true)} />;

  return (
    <div className={`app${sidebarOpen ? "" : " sidebar-hidden"}`}>
      {sidebarOpen && (
        <Sidebar
          summaries={summaries}
          projects={projects}
          projectError={projectError}
          activeId={chat && chat.messages.length ? chat.id : null}
          activeProjectId={chat ? (projectFor(chat, projects)?.id ?? null) : null}
          usage={usage}
          onSelect={(id) => void openChat(id)}
          onNew={newChat}
          onDelete={(id) => void removeChat(id)}
          onRename={(id, title) => void renameChat(id, title)}
          onPin={(id) => void togglePin(id)}
          onAddProject={() => void addProjectFromFolder()}
          onNewInProject={newChatIn}
          onRemoveProject={(id) => void removeProject(id)}
          onRenameProject={(id, name) => void renameProject(id, name)}
          onToggle={() => setSidebarOpen(false)}
          onSettings={() => setSettingsOpen(true)}
        />
      )}
      {chat && (
        <ChatView
          key={chat.id}
          chat={chat}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(true)}
          onSettingsChange={writeDefaults}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          usage={usage}
          onClose={() => setSettingsOpen(false)}
          onKeyRemoved={() => {
            setSettingsOpen(false);
            setHasKey(false);
          }}
        />
      )}
    </div>
  );
}
