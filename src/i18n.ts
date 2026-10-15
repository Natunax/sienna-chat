import { useSyncExternalStore } from "react";

// Interface texts in German and English. By default the language follows the
// Mac's preferred language (reported by Rust, see `app_language`); anything
// that is not German gets English. The settings can pin German or English. Rust and the engine send error codes (`error.*`)
// that are translated here too.

const de = {
  "app.newChat": "Neuer Chat",
  "app.image": "Bild",

  "sidebar.hide": "Seitenleiste ausblenden",
  "sidebar.show": "Seitenleiste einblenden",
  "sidebar.shortcut": "Seitenleiste (⌘\\)",
  "sidebar.new": "Neuer Chat",
  "sidebar.newShortcut": "Neuer Chat (⌘N)",
  "sidebar.search": "Chats durchsuchen",
  "sidebar.chats": "Chats",
  "sidebar.empty": "Deine Chats erscheinen hier.",
  "sidebar.noMatch": "Kein Chat passt zur Suche.",
  "sidebar.pinned": "Angeheftet",
  "sidebar.projects": "Projekte",
  "sidebar.addProject": "Projekt hinzufügen",
  "sidebar.addProjectHint": "Ordner als Projekt hinzufügen",
  "sidebar.newInProject": "Neuer Chat in {name}",
  "sidebar.projectStart": "Ersten Chat starten",
  "sidebar.removeProject": "Entfernen",
  "sidebar.removeProjectLabel": "{name} aus den Projekten entfernen",
  "sidebar.removeProjectHint": "Aus den Projekten entfernen; Ordner und Chats bleiben",
  "chat.projectHint": "Claude kann {name} lesen und durchsuchen",
  "sidebar.today": "Heute",
  "sidebar.yesterday": "Gestern",
  "sidebar.week": "Letzte 7 Tage",
  "sidebar.month": "Letzte 30 Tage",
  "sidebar.older": "Älter",
  "sidebar.renameHint": "Doppelklick zum Umbenennen",
  "sidebar.rename": "Chat umbenennen",
  "sidebar.pin": "Anheften",
  "sidebar.unpin": "Lösen",
  "sidebar.pinLabel": "{title} anheften",
  "sidebar.unpinLabel": "{title} lösen",
  "sidebar.delete": "Chat löschen",
  "sidebar.deleteLabel": "{title} löschen",
  "sidebar.confirmDelete": "Löschen",
  "sidebar.spend": "{amount} in Sienna",
  "sidebar.spendFallback": "Kosten",
  "sidebar.spendHint":
    "Diesen Monat in Sienna, von {budget} Budget. Den Gesamtverbrauch deiner Organisation zeigt die Claude Console. Einstellungen (⌘,)",
  "sidebar.settings": "Einstellungen (⌘,)",

  "chat.cost": "Kosten dieses Chats",
  "chat.greetMorning": "Guten Morgen. Womit fangen wir an?",
  "chat.greetDay": "Was steht heute an?",
  "chat.greetEvening": "Guten Abend. Woran tüftelst du?",
  "chat.greetNight": "Noch wach? Lass uns nachdenken.",
  "chat.heroHint": "Läuft über dein API-Guthaben, nicht über dein Claude-Abo.",
  "chat.drop": "Bilder, PDFs oder Textdateien hier ablegen",

  "composer.placeholder": "Schieß los",
  "composer.more": "Anhängen und Optionen",
  "composer.webOff": "Websuche ausschalten",
  "composer.label": "Nachricht",
  "composer.attach": "Datei anhängen",
  "composer.attachHint": "Bild, PDF oder Textdatei anhängen",
  "composer.web": "Websuche",
  "composer.webHint": "Claude darf im Web suchen",
  "composer.project": "Ordner",
  "composer.projectPick": "Projektordner wählen: Claude darf ihn lesen und durchsuchen",
  "composer.projectActive": "Claude darf {name} lesen und durchsuchen, aber nichts ändern",
  "composer.projectLocked": "Claude liest {name}. Für einen anderen Ordner einen neuen Chat starten.",
  "composer.projectRemove": "Ordner entfernen",
  "composer.projectTitle": "Projektordner wählen",
  "composer.modelHint": "Modell und Aufwand",
  "composer.effort": "Aufwand",
  "composer.send": "Senden",
  "composer.sendHint": "Senden (↩)",
  "composer.stop": "Antwort stoppen",
  "composer.stopHint": "Stoppen (⌘.)",
  "composer.remove": "{name} entfernen",
  "composer.fileType": "Nur Bilder, PDFs und Textdateien wie Code, Markdown oder CSV.",
  "composer.textSize": "Textdateien dürfen höchstens 512 KB groß sein.",
  "composer.notText": "Das ist keine lesbare Textdatei.",
  "composer.pdfSize": "PDFs dürfen höchstens 20 MB groß sein.",
  "composer.imageSize": "Bilder dürfen höchstens 5 MB groß sein.",
  "composer.readError": "Die Datei konnte nicht gelesen werden.",

  "model.other": "Sonstige",
  "effort.low": "Niedrig",
  "effort.medium": "Mittel",
  "effort.high": "Hoch",
  "effort.xhigh": "Extra hoch",
  "effort.max": "Maximal",

  "message.thinking": "Denkt nach…",
  "message.thoughts": "Gedankengang",
  "message.copy": "Antwort kopieren",
  "message.copied": "Kopiert",
  "message.regenerate": "Antwort neu erzeugen",
  "message.edit": "Nachricht bearbeiten",
  "message.cancel": "Abbrechen",
  "message.send": "Senden",
  "message.searching": "Sucht im Web",
  "message.reading": "Liest Seite",
  "message.readFile": "Liest",
  "message.grep": "Durchsucht",
  "message.glob": "Sucht Dateien",
  "code.copy": "Kopieren",
  "code.copied": "Kopiert",
  "code.copyLabel": "Code kopieren",
  "code.fallback": "Code",

  "key.title": "Verbinde deinen API-Key",
  "key.text":
    "Gespräche laufen über dein API-Guthaben, nicht über dein Claude-Abo. Der Key bleibt im Schlüsselbund deines Macs.",
  "key.label": "API-Key",
  "key.create": "Key in der Claude Console erstellen",
  "key.connect": "Verbinden",
  "key.save": "Speichern",
  "key.saving": "Speichert…",

  "settings.title": "Einstellungen",
  "settings.language": "Sprache",
  "settings.languageSystem": "System",
  "settings.close": "Schließen",
  "settings.key": "API-Key",
  "settings.keyStored": "Im Schlüsselbund gespeichert",
  "settings.replace": "Ersetzen",
  "settings.remove": "Entfernen",
  "settings.keySaved": "Neuer Key gespeichert.",
  "settings.costs": "Kosten in Sienna diesen Monat",
  "settings.costsHint":
    "Nur was diese App verbraucht hat, nach den Schätzungen des SDK. Die Claude Console zeigt alles, was über deine Organisation läuft, auch andere Keys und den Playground.",
  "settings.costsTotal": "Gesamt in Sienna",
  "settings.noCosts": "Noch keine Kosten in diesem Monat.",
  "settings.console": "Gesamtverbrauch in der Console ansehen",
  "settings.budget": "Monatsbudget",
  "settings.budgetHint":
    "Gilt nur für Sienna: Ist es erreicht, nimmt die App keine Nachrichten mehr an. Die harte Grenze für alles ist das Ausgabenlimit in der Claude Console.",
  "settings.budgetLabel": "Monatsbudget in Dollar",
  "settings.budgetSave": "Budget speichern",
  "settings.budgetSaved": "Budget gespeichert.",

  "error.generic": "Etwas ist schiefgelaufen.",
  "error.keychainUnavailable": "Der Schlüsselbund ist nicht erreichbar.",
  "error.keyFormat": "Das sieht nicht wie ein Anthropic-API-Key aus.",
  "error.keySave": "Der Key konnte nicht im Schlüsselbund gespeichert werden.",
  "error.keyDelete": "Der Key konnte nicht entfernt werden.",
  "error.invalidRequest": "Ungültige Anfrage.",
  "error.messageTooLong": "Die Nachricht ist zu lang.",
  "error.messageEmpty": "Die Nachricht ist leer.",
  "error.attachmentType": "Nur Bilder, PDFs und Textdateien können angehängt werden.",
  "error.attachmentsTooLarge": "Die Anhänge sind zusammen zu groß.",
  "error.budgetReached": "Das Monatsbudget ist aufgebraucht.",
  "error.budgetRange": "Das Budget muss zwischen 1 und 10.000 $ liegen.",
  "error.unknownChat": "Unbekannter Chat.",
  "error.chatNotFound": "Der Chat wurde nicht gefunden.",
  "error.chatDamaged": "Der Chat ist beschädigt.",
  "error.saveFailed": "Speichern fehlgeschlagen.",
  "error.noKey": "Kein API-Key hinterlegt.",
  "error.nodeMissing": "Node.js wurde nicht gefunden. Installiere es mit Homebrew: brew install node",
  "error.engineMissing": "Die Chat-Engine fehlt im App-Paket.",
  "error.engineStart": "Die Chat-Engine konnte nicht gestartet werden.",
  "error.engineNoResponse": "Die Chat-Engine antwortet nicht.",
  "error.engineBlocked": "Die Chat-Engine ist blockiert.",
  "error.engineStopped": "Die Chat-Engine wurde beendet. Bitte noch einmal senden.",
  "error.wrongCredential": "Die Engine lief nicht mit dem API-Key und wurde gestoppt.",
  "error.interrupted": "Die Antwort wurde unterbrochen.",
  "error.keyRejected": "Der API-Key wurde abgelehnt.",
  "error.creditExhausted": "Das API-Guthaben oder Ausgabenlimit ist erreicht.",
  "error.rateLimited": "Zu viele Anfragen. Bitte gleich noch einmal versuchen.",
  "error.overloaded": "Claude ist gerade überlastet. Bitte gleich noch einmal versuchen.",
  "error.answerFailed": "Die Antwort ist fehlgeschlagen.",
  "error.refused": "Claude hat diese Anfrage aus Sicherheitsgründen abgelehnt.",
  "error.projectInvalid":
    "Dieser Ordner geht nicht. Wähl einen Ordner in deinem Benutzerordner, nicht den Benutzerordner selbst und keinen versteckten.",
};

export type TextKey = keyof typeof de;

const en: Record<TextKey, string> = {
  "app.newChat": "New chat",
  "app.image": "Image",

  "sidebar.hide": "Hide sidebar",
  "sidebar.show": "Show sidebar",
  "sidebar.shortcut": "Sidebar (⌘\\)",
  "sidebar.new": "New chat",
  "sidebar.newShortcut": "New chat (⌘N)",
  "sidebar.search": "Search chats",
  "sidebar.chats": "Chats",
  "sidebar.empty": "Your chats appear here.",
  "sidebar.noMatch": "No chat matches the search.",
  "sidebar.pinned": "Pinned",
  "sidebar.projects": "Projects",
  "sidebar.addProject": "Add project",
  "sidebar.addProjectHint": "Add a folder as a project",
  "sidebar.newInProject": "New chat in {name}",
  "sidebar.projectStart": "Start the first chat",
  "sidebar.removeProject": "Remove",
  "sidebar.removeProjectLabel": "Remove {name} from projects",
  "sidebar.removeProjectHint": "Remove from projects; the folder and chats stay",
  "chat.projectHint": "Claude can read and search {name}",
  "sidebar.today": "Today",
  "sidebar.yesterday": "Yesterday",
  "sidebar.week": "Previous 7 days",
  "sidebar.month": "Previous 30 days",
  "sidebar.older": "Older",
  "sidebar.renameHint": "Double-click to rename",
  "sidebar.rename": "Rename chat",
  "sidebar.pin": "Pin",
  "sidebar.unpin": "Unpin",
  "sidebar.pinLabel": "Pin {title}",
  "sidebar.unpinLabel": "Unpin {title}",
  "sidebar.delete": "Delete chat",
  "sidebar.deleteLabel": "Delete {title}",
  "sidebar.confirmDelete": "Delete",
  "sidebar.spend": "{amount} in Sienna",
  "sidebar.spendFallback": "Costs",
  "sidebar.spendHint":
    "This month in Sienna, of a {budget} budget. The Claude Console shows what your whole organization spends. Settings (⌘,)",
  "sidebar.settings": "Settings (⌘,)",

  "chat.cost": "Cost of this chat",
  "chat.greetMorning": "Good morning. Where do we start?",
  "chat.greetDay": "What's on today?",
  "chat.greetEvening": "Good evening. What are you working on?",
  "chat.greetNight": "Still up? Let's think it through.",
  "chat.heroHint": "Runs on your API credit, not your Claude subscription.",
  "chat.drop": "Drop images, PDFs or text files here",

  "composer.placeholder": "Fire away",
  "composer.more": "Attach and options",
  "composer.webOff": "Turn off web search",
  "composer.label": "Message",
  "composer.attach": "Attach file",
  "composer.attachHint": "Attach an image, PDF or text file",
  "composer.web": "Web search",
  "composer.webHint": "Let Claude search the web",
  "composer.project": "Folder",
  "composer.projectPick": "Choose a project folder for Claude to read and search",
  "composer.projectActive": "Claude may read and search {name}, but not change anything",
  "composer.projectLocked": "Claude reads {name}. Start a new chat for another folder.",
  "composer.projectRemove": "Remove folder",
  "composer.projectTitle": "Choose a project folder",
  "composer.modelHint": "Model and effort",
  "composer.effort": "Effort",
  "composer.send": "Send",
  "composer.sendHint": "Send (↩)",
  "composer.stop": "Stop answer",
  "composer.stopHint": "Stop (⌘.)",
  "composer.remove": "Remove {name}",
  "composer.fileType": "Only images, PDFs and text files such as code, Markdown or CSV.",
  "composer.textSize": "Text files can be at most 512 KB.",
  "composer.notText": "This is not a readable text file.",
  "composer.pdfSize": "PDFs can be at most 20 MB.",
  "composer.imageSize": "Images can be at most 5 MB.",
  "composer.readError": "The file could not be read.",

  "model.other": "Other",
  "effort.low": "Low",
  "effort.medium": "Medium",
  "effort.high": "High",
  "effort.xhigh": "Extra high",
  "effort.max": "Max",

  "message.thinking": "Thinking…",
  "message.thoughts": "Thoughts",
  "message.copy": "Copy answer",
  "message.copied": "Copied",
  "message.regenerate": "Regenerate answer",
  "message.edit": "Edit message",
  "message.cancel": "Cancel",
  "message.send": "Send",
  "message.searching": "Searching the web",
  "message.reading": "Reading page",
  "message.readFile": "Reading",
  "message.grep": "Searching",
  "message.glob": "Finding files",
  "code.copy": "Copy",
  "code.copied": "Copied",
  "code.copyLabel": "Copy code",
  "code.fallback": "Code",

  "key.title": "Connect your API key",
  "key.text": "Chats run on your API credit, not your Claude subscription. The key stays in your Mac's Keychain.",
  "key.label": "API key",
  "key.create": "Create a key in the Claude Console",
  "key.connect": "Connect",
  "key.save": "Save",
  "key.saving": "Saving…",

  "settings.title": "Settings",
  "settings.language": "Language",
  "settings.languageSystem": "System",
  "settings.close": "Close",
  "settings.key": "API key",
  "settings.keyStored": "Stored in the Keychain",
  "settings.replace": "Replace",
  "settings.remove": "Remove",
  "settings.keySaved": "New key saved.",
  "settings.costs": "Costs in Sienna this month",
  "settings.costsHint":
    "Only what this app used, as estimated by the SDK. The Claude Console shows everything your organization spends, including other keys and the Playground.",
  "settings.costsTotal": "Total in Sienna",
  "settings.noCosts": "No costs this month yet.",
  "settings.console": "See total spend in the Console",
  "settings.budget": "Monthly budget",
  "settings.budgetHint":
    "Applies to Sienna only: once reached, the app stops sending. The hard limit for everything is the spend limit in the Claude Console.",
  "settings.budgetLabel": "Monthly budget in dollars",
  "settings.budgetSave": "Save budget",
  "settings.budgetSaved": "Budget saved.",

  "error.generic": "Something went wrong.",
  "error.keychainUnavailable": "The Keychain cannot be reached.",
  "error.keyFormat": "This does not look like an Anthropic API key.",
  "error.keySave": "The key could not be saved in the Keychain.",
  "error.keyDelete": "The key could not be removed.",
  "error.invalidRequest": "Invalid request.",
  "error.messageTooLong": "The message is too long.",
  "error.messageEmpty": "The message is empty.",
  "error.attachmentType": "Only images, PDFs and text files can be attached.",
  "error.attachmentsTooLarge": "The attachments are too large together.",
  "error.budgetReached": "The monthly budget is used up.",
  "error.budgetRange": "The budget must be between 1 and 10,000 dollars.",
  "error.unknownChat": "Unknown chat.",
  "error.chatNotFound": "The chat was not found.",
  "error.chatDamaged": "The chat is damaged.",
  "error.saveFailed": "Saving failed.",
  "error.noKey": "No API key stored.",
  "error.nodeMissing": "Node.js was not found. Install it with Homebrew: brew install node",
  "error.engineMissing": "The chat engine is missing from the app bundle.",
  "error.engineStart": "The chat engine could not be started.",
  "error.engineNoResponse": "The chat engine does not respond.",
  "error.engineBlocked": "The chat engine is blocked.",
  "error.engineStopped": "The chat engine stopped. Please send again.",
  "error.wrongCredential": "The engine was not running on the API key and was stopped.",
  "error.interrupted": "The answer was interrupted.",
  "error.keyRejected": "The API key was rejected.",
  "error.creditExhausted": "The API credit or spend limit is used up.",
  "error.rateLimited": "Too many requests. Please try again in a moment.",
  "error.overloaded": "Claude is overloaded right now. Please try again in a moment.",
  "error.answerFailed": "The answer failed.",
  "error.refused": "Claude declined this request for safety reasons.",
  "error.projectInvalid":
    "This folder cannot be used. Choose a folder inside your home folder, not the home folder itself and not a hidden one.",
};

let texts: Record<TextKey, string> = de;
let localeTag = "de-DE";

export type LanguageChoice = "system" | "de" | "en";

const CHOICE_KEY = "language";
let systemLocale = "en-US";
let choice: LanguageChoice = readChoice();
let version = 0;
const listeners = new Set<() => void>();

function readChoice(): LanguageChoice {
  try {
    const stored = localStorage.getItem(CHOICE_KEY);
    return stored === "de" || stored === "en" ? stored : "system";
  } catch {
    return "system";
  }
}

/** Picks German for a German locale and English for everything else. */
function apply() {
  const tag = choice === "de" ? "de-DE" : choice === "en" && !/^en\b/i.test(systemLocale) ? "en-US" : systemLocale;
  const german = tag.toLowerCase().startsWith("de");
  texts = german ? de : en;
  localeTag = german ? "de-DE" : tag.includes("-") ? tag : "en-US";
  document.documentElement.lang = german ? "de" : "en";
}

/** Called once before the first render with the Mac's preferred language. */
export function initLanguage(system: string) {
  systemLocale = system || "en-US";
  apply();
}

export function languageChoice(): LanguageChoice {
  return choice;
}

export function setLanguageChoice(next: LanguageChoice) {
  choice = next;
  try {
    if (next === "system") localStorage.removeItem(CHOICE_KEY);
    else localStorage.setItem(CHOICE_KEY, next);
  } catch {
    // The choice still applies until the app restarts.
  }
  apply();
  version += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders the caller when the language changes; returns a change counter. */
export function useLanguage(): number {
  return useSyncExternalStore(subscribe, () => version);
}

/** The locale for numbers and dates. */
export function locale(): string {
  return localeTag;
}

export function t(key: TextKey, vars?: Record<string, string | number>): string {
  let text = texts[key] ?? key;
  if (vars) for (const [name, value] of Object.entries(vars)) text = text.replace(`{${name}}`, String(value));
  return text;
}

/** Translates an error code from Rust or the engine; anything else gets a generic text. */
export function errorText(error: unknown): string {
  return typeof error === "string" && error in texts ? texts[error as TextKey] : texts["error.generic"];
}

/** Like `errorText`, but keeps a plain text stored by an older version of the app. */
export function storedErrorText(error: string): string {
  return error in texts ? texts[error as TextKey] : error.startsWith("error.") ? texts["error.generic"] : error;
}
