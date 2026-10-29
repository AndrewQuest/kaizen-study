// Global UI state: current view, timer snapshot, settings, and the side effects
// (sound + notifications) triggered by timer events.
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { disable as disableAutostart, enable as enableAutostart } from "@tauri-apps/plugin-autostart";
import { api, DEFAULT_SHORTCUT, type AppInfo, type BlockEnd, type BreakActivity, type TimerSnapshot } from "./api";
import { i18n, t } from "./i18n/i18n.svelte";
import { setAttachmentsDir } from "./render";

export type View = "today" | "subjects" | "session" | "notes" | "reviews" | "stats" | "settings";

export interface Settings {
  theme: "system" | "light" | "dark";
  sound: boolean;
  volume: number;
  notifications: boolean;
  shortcut: string;
  locale: string;
  last_template: string;
  daily_goal_min: number;
  nav_compact: boolean;
  session_compact: boolean;
  spell_enabled: boolean;
  /** Comma-separated spell-check languages. */
  spell_langs: string;
  autostart: boolean;
  phone_ev_block: boolean;
  phone_ev_daily: boolean;
  daily_time: string;
  phone_ev_planned: boolean;
  planned_lead_min: number;
  phone_ntfy: boolean;
  ntfy_server: string;
  ntfy_topic: string;
  phone_telegram: boolean;
  telegram_chat_id: string;
  phone_email: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_security: string;
  smtp_user: string;
  smtp_to: string;
  editor_mode: "hybrid" | "split";
  dictation_lang: "es" | "en" | "auto";
  /** Microphone name for dictation ("" = Windows default). */
  dictation_device: string;
  /** Interface zoom of the main window (0.8 – 2). */
  ui_scale: number;
  notes_hide_tree: boolean;
  notes_hide_list: boolean;
  /** Notebook mode: only the note and its toolbar (no menu, no side panels). */
  notebook: boolean;
}

const DEFAULTS: Settings = {
  theme: "system",
  sound: true,
  volume: 0.6,
  notifications: true,
  shortcut: DEFAULT_SHORTCUT,
  locale: "es",
  last_template: "pomodoro",
  daily_goal_min: 120,
  nav_compact: false,
  session_compact: false,
  spell_enabled: true,
  spell_langs: "es,en",
  autostart: true,
  phone_ev_block: false,
  phone_ev_daily: false,
  daily_time: "08:00",
  phone_ev_planned: true,
  planned_lead_min: 15,
  phone_ntfy: false,
  ntfy_server: "https://ntfy.sh",
  ntfy_topic: "",
  phone_telegram: false,
  telegram_chat_id: "",
  phone_email: false,
  smtp_host: "",
  smtp_port: 587,
  smtp_security: "starttls",
  smtp_user: "",
  smtp_to: "",
  editor_mode: "hybrid",
  dictation_lang: "es",
  dictation_device: "",
  ui_scale: 1,
  notes_hide_tree: false,
  notes_hide_list: false,
  notebook: false,
};

class AppStore {
  view = $state<View>("today");
  info = $state<AppInfo | null>(null);
  timer = $state<TimerSnapshot | null>(null);
  settings = $state<Settings>({ ...DEFAULTS });
  /** Raw settings map (also holds per-method keys such as `break_plan_<method>`). */
  rawSettings: Record<string, string> = {};
  activities = $state<BreakActivity[]>([]);
  /** Preselected method for the "start session" dialog (e.g. from a planned study). */
  startTemplateId = $state<string | null>(null);
  /** Pre-selection for the "start session" dialog and the notes view. */
  startOpen = $state(false);
  startTopicId = $state<string | null>(null);
  notesTopicId = $state<string | null>(null);
  subjectId = $state<string | null>(null);
  /** Session that just ended and is waiting for a rating. */
  justFinished = $state<{ id: string; focus: number } | null>(null);
  /** Bumped whenever data changes so views can refetch. */
  revision = $state(0);
  toast = $state<{ text: string; error?: boolean } | null>(null);

  async init() {
    this.info = await api.appInfo();
    document.documentElement.classList.toggle("mica", this.info.mica);
    // Browsers only allow sound after a user gesture: unlock audio on the first click/key.
    const unlock = () => void ensureAudio();
    addEventListener("pointerdown", unlock, { once: true });
    addEventListener("keydown", unlock, { once: true });
    // Links rendered as HTML (tables, previews) must never navigate the app window.
    addEventListener(
      "click",
      (e) => {
        const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
        if (!a) return;
        e.preventDefault();
        // Inside a note being edited, links need Ctrl + click (a plain click edits); elsewhere
        // (reading mode, split preview) a plain click opens them.
        const editing = a.closest(".cm-content")?.getAttribute("contenteditable") === "true";
        if (editing && !(e.ctrlKey || e.metaKey)) return;
        const href = a.getAttribute("href") ?? "";
        if (/^(https?:|mailto:|tel:)/i.test(href)) void api.openExternal(href).catch((err) => this.fail(err));
      },
      true,
    );
    // Native feel: no browser context menu except where text can be edited.
    addEventListener("contextmenu", (e) => {
      const el = e.target as HTMLElement;
      if (!el.closest("input, textarea, [contenteditable='true'], .cm-content")) e.preventDefault();
    });
    if (this.info.data_dir) await this.loadSettings();
    if (this.info.shortcut_error) {
      this.notify(t("settings.shortcut_failed", { key: this.settings.shortcut.replace("CommandOrControl", "Ctrl") }), true, 8000);
    }
    this.timer = await api.timerState();
    await listen<TimerSnapshot>("timer://tick", (e) => (this.timer = e.payload));
    await listen<string>("timer://finished", (e) => {
      const focus = this.timer?.focus_total ?? 0;
      this.timer = null;
      this.justFinished = { id: e.payload, focus };
      this.refresh();
    });
    await listen<BlockEnd>("timer://block-end", (e) => this.onBlockEnd(e.payload));
    // WebView2 does not reliably report the Windows theme through prefers-color-scheme,
    // so "system" follows the window theme reported by Tauri.
    await getCurrentWindow().onThemeChanged(() => {
      if (this.settings.theme === "system") void this.applyTheme();
    });
  }

  async loadSettings() {
    const raw = await api.getSettings();
    this.rawSettings = raw;
    const s: Settings = { ...DEFAULTS };
    for (const [k, v] of Object.entries(raw)) {
      if (!(k in DEFAULTS)) continue;
      const def = DEFAULTS[k as keyof Settings];
      (s as any)[k] = typeof def === "boolean" ? v === "true" : typeof def === "number" ? Number(v) : v;
    }
    // Start with Windows is on by default, but only the release build registers itself;
    // dev and test runs show it off so the toggle always reflects reality.
    if (raw.autostart === undefined && !this.info?.autostart_default) s.autostart = false;
    this.settings = s;
    this.activities = await api.listActivities();
    setAttachmentsDir(await api.attachmentsDir());
    if (raw.autostart === undefined && this.info?.autostart_default) {
      await this.setSetting("autostart", true);
    }
    i18n.locale = s.locale;
    await this.applyTheme();
    await this.applyScale();
    await api.setTrayLabels(
      Object.fromEntries(
        ["show", "toggle", "finish", "quit", "focus", "break", "paused", "daily_title", "daily_body", "planned_title", "planned_body"]
          .map((k) => [k, t(`tray.${k}`)]),
      ),
    );
  }

  async setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    this.settings[key] = value;
    await api.setSetting(key, String(value));
    this.rawSettings[key] = String(value);
    if (key === "theme") await this.applyTheme();
    if (key === "ui_scale") await this.applyScale();
    if (key === "autostart") await (value ? enableAutostart() : disableAutostart()).catch((e) => this.fail(e));
    if (key === "locale") await this.loadSettings();
  }

  /** Zooms the whole main window (text, icons, buttons); the mini window is not affected. */
  async applyScale() {
    const scale = Math.min(2, Math.max(0.8, Number(this.settings.ui_scale) || 1));
    await getCurrentWebview().setZoom(scale).catch(() => {});
  }

  async applyTheme() {
    const theme = this.settings.theme;
    const win = getCurrentWindow();
    // Set the window theme first: with `null` the window follows Windows again,
    // and then win.theme() reports the effective system theme.
    await win.setTheme(theme === "system" ? null : theme).catch(() => {});
    const effective = theme === "system" ? await systemTheme() : theme;
    document.documentElement.dataset.theme = effective;
  }

  activity(id: string | null | undefined): BreakActivity | undefined {
    if (id?.startsWith(TMP_ACTIVITY)) return parseTmpActivity(id);
    return this.activities.find((a) => a.id === id);
  }

  /** Default break plan of a method (last plan used or set in Settings). */
  breakPlan(templateId: string): string[] {
    return (this.rawSettings[`break_plan_${templateId}`] ?? "").split(",").filter(Boolean);
  }

  async setBreakPlan(templateId: string, plan: string[]) {
    // Session-only activities are not remembered as the method's default.
    const value = plan.filter((id) => !id.startsWith(TMP_ACTIVITY)).join(",");
    this.rawSettings[`break_plan_${templateId}`] = value;
    await api.setSetting(`break_plan_${templateId}`, value);
  }

  async reloadActivities() {
    this.activities = await api.listActivities();
  }

  refresh() {
    this.revision++;
  }

  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  notify(text: string, error = false, ms = 3500) {
    this.toast = { text, error };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = null), ms);
  }

  fail(err: unknown) {
    this.notify(`${t("common.error")}: ${err}`, true);
  }

  openStart(topicId: string | null = null, templateId: string | null = null) {
    if (this.timer) {
      this.view = "session";
      return;
    }
    this.startTopicId = topicId;
    this.startTemplateId = templateId;
    this.startOpen = true;
  }

  private async onBlockEnd(e: BlockEnd) {
    if (this.settings.sound) playChime(this.settings.volume, e.finished === "focus");
    let title: string, body: string;
    if (e.finished === "focus") {
      title = t("session.notif_focus_end");
      body = t(e.long_break ? "session.notif_long_end_body" : "session.notif_focus_end_body", {
        n: e.next_minutes,
      });
      const act = this.activity(e.activity);
      if (act) body += ` ${t("session.notif_activity", { emoji: act.emoji, name: act.name })}`;
    } else {
      title = t("session.notif_break_end");
      body = t(this.timer?.mode === "flow" ? "session.notif_break_end_flow" : "session.notif_break_end_body");
    }
    if (this.settings.phone_ev_block) void api.phoneNotify("block", title, body).catch(() => {});
    if (!this.settings.notifications) return;
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) sendNotification({ title, body });
  }
}

export const app = new AppStore();

/** Prefix of activities created for one session only (encoded inside the plan). */
export const TMP_ACTIVITY = "tmp:";

export function tmpActivityId(a: Pick<BreakActivity, "emoji" | "name" | "instructions">) {
  return TMP_ACTIVITY + encodeURIComponent(JSON.stringify([a.emoji, a.name, a.instructions]));
}

function parseTmpActivity(id: string): BreakActivity | undefined {
  try {
    const [emoji, name, instructions] = JSON.parse(decodeURIComponent(id.slice(TMP_ACTIVITY.length)));
    return { id, emoji, name, instructions, sort: 0 };
  } catch {
    return undefined;
  }
}

/** Effective Windows theme (falls back to the CSS media query). */
export async function systemTheme(): Promise<"light" | "dark"> {
  try {
    const t = await getCurrentWindow().theme();
    if (t) return t;
  } catch {}
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let audio: AudioContext | null = null;

function ensureAudio(): AudioContext {
  audio ??= new AudioContext();
  if (audio.state === "suspended") void audio.resume();
  return audio;
}

/** Soft two/three-note chime synthesized with WebAudio (no audio files to ship). */
export function playChime(volume: number, rising = true) {
  const ctx = ensureAudio();
  const notes = rising ? [523.25, 659.25, 783.99] : [783.99, 523.25];
  notes.forEach((freq, i) => {
    const start = ctx.currentTime + i * 0.18;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.35 * volume, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 1);
  });
}
