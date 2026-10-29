// Typed wrappers around the Rust commands (src-tauri/src/commands.rs).
import { invoke } from "@tauri-apps/api/core";

export interface Subject {
  id: string;
  name: string;
  color: string;
  icon: string;
  archived: boolean;
  created_at: string;
}

export type TopicStatus = "nuevo" | "aprendiendo" | "repasando" | "dominado";

export interface Topic {
  id: string;
  subject_id: string;
  name: string;
  template_id: string | null;
  status: TopicStatus;
  stage: string | null;
  exam_date: string | null;
  created_at: string;
  session_count: number;
  focus_seconds: number;
}

export interface Session {
  id: string;
  topic_id: string;
  template_id: string | null;
  config_json: string;
  started_at: string;
  ended_at: string | null;
  planned_minutes: number;
  focus_seconds: number;
  break_seconds: number;
  rating: number | null;
  notes_md: string;
  notes_moved: boolean;
}

export type NoteLayout = "libre" | "cornell" | "feynman" | "preguntas" | "latex" | "latexdoc";

export interface Note {
  id: string;
  topic_id: string;
  title: string;
  body_md: string;
  layout: NoteLayout;
  updated_at: string;
}

export interface NoteHit extends Note {
  topic_name: string;
  subject_name: string;
  subject_color: string;
}

export interface Review {
  id: string;
  topic_id: string;
  topic_name: string;
  subject_name: string;
  subject_color: string;
  due_date: string;
  step: number;
  kind: "leitner" | "examen";
  done_at: string | null;
  result: string | null;
}

export type ReviewResult = "facil" | "bien" | "dificil";

export interface Stats {
  daily: { date: string; seconds: number }[];
  by_subject: { name: string; color: string; seconds: number }[];
  today_seconds: number;
  total_seconds: number;
  session_count: number;
  streak: number;
  best_streak: number;
}

export interface TimerConfig {
  mode: "intervals" | "flow";
  focus_min: number;
  break_min: number;
  long_break_min: number;
  long_every: number;
  flow_ratio: number;
  spaced: boolean;
  /** Activity ids for consecutive breaks (cycled). */
  break_plan: string[];
}

export interface TimerSnapshot {
  session_id: string;
  topic_id: string;
  topic_name: string;
  subject_name: string;
  subject_color: string;
  template_id: string | null;
  mode: "intervals" | "flow";
  kind: "focus" | "break";
  paused: boolean;
  elapsed: number;
  duration: number | null;
  cycle: number;
  focus_total: number;
  break_total: number;
  activity: string | null;
}

export interface BlockEnd {
  finished: "focus" | "break";
  next: "focus" | "break";
  next_minutes: number;
  long_break: boolean;
  activity: string | null;
}

export interface BreakActivity {
  id: string;
  emoji: string;
  name: string;
  instructions: string;
  sort: number;
}

export interface PlannedStudy {
  id: string;
  topic_id: string;
  template_id: string | null;
  start_date: string;
  time: string;
  duration_min: number;
  /** ISO weekdays "1".."7" (Monday = 1), comma separated; "" = one-off. */
  repeat_days: string;
  repeat_until: string | null;
  created_at?: string;
}

export interface PlannedOccurrence {
  plan_id: string;
  topic_id: string;
  topic_name: string;
  subject_name: string;
  subject_color: string;
  template_id: string | null;
  date: string;
  time: string;
  duration_min: number;
  repeats: boolean;
}

export interface Exam {
  topic_id: string;
  topic_name: string;
  subject_name: string;
  subject_color: string;
  exam_date: string;
}

export interface QuickNoteHit extends Session {
  topic_name: string;
  subject_name: string;
  subject_color: string;
}

export interface ToolsStatus {
  latex: boolean;
  whisper: string | null;
  recording: boolean;
}

export interface WhisperModel {
  id: string;
  size_mb: number;
  accuracy: number;
  speed: number;
  installed: boolean;
}

export interface LatexResult {
  pdf: string | null;
  log: string;
}

export interface ToolProgress {
  tool: "tectonic" | "whisper";
  done: number;
  total: number;
}

export type PhoneChannel = "ntfy" | "telegram" | "email";
export type SecretKey = "telegram_token" | "smtp_password" | "ntfy_token";

export interface AppInfo {
  data_dir: string | null;
  mica: boolean;
  version: string;
  shortcut_error: string | null;
  /** Release build outside tests: "start with Windows" defaults to on. */
  autostart_default: boolean;
}

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  setDataDir: (path: string, mode: "open" | "move") => invoke<void>("set_data_dir", { path, mode }),

  listSubjects: (includeArchived = false) => invoke<Subject[]>("list_subjects", { includeArchived }),
  saveSubject: (subject: Partial<Subject>) =>
    invoke<Subject>("save_subject", {
      subject: { id: "", icon: "📘", archived: false, created_at: "", ...subject },
    }),
  deleteSubject: (id: string) => invoke<void>("delete_subject", { id }),

  listTopics: (subjectId: string) => invoke<Topic[]>("list_topics", { subjectId }),
  getTopic: (id: string) => invoke<Topic>("get_topic", { id }),
  saveTopic: (topic: Partial<Topic>) =>
    invoke<Topic>("save_topic", {
      topic: {
        id: "",
        template_id: null,
        status: "nuevo",
        stage: null,
        exam_date: null,
        created_at: "",
        session_count: 0,
        focus_seconds: 0,
        ...topic,
      },
    }),
  deleteTopic: (id: string) => invoke<void>("delete_topic", { id }),
  listSessions: (topicId: string) => invoke<Session[]>("list_sessions", { topicId }),

  listNotes: (topicId: string) => invoke<Note[]>("list_notes", { topicId }),
  searchNotes: (query: string) => invoke<NoteHit[]>("search_notes", { query }),
  saveNote: (note: Partial<Note> & { topic_id: string }) =>
    invoke<Note>("save_note", {
      note: { id: "", title: "", body_md: "", layout: "libre", updated_at: "", ...note },
    }),
  deleteNote: (id: string) => invoke<void>("delete_note", { id }),

  listReviews: (from: string, to: string) => invoke<Review[]>("list_reviews", { from, to }),
  dueReviews: () => invoke<Review[]>("due_reviews"),
  completeReview: (id: string, result: ReviewResult) => invoke<void>("complete_review", { id, result }),

  stats: (days: number) => invoke<Stats>("stats", { days }),

  getSettings: () => invoke<Record<string, string>>("get_settings"),
  setSetting: (key: string, value: string) => invoke<void>("set_setting", { key, value }),
  setShortcut: (shortcut: string) => invoke<void>("set_shortcut", { shortcut }),
  setTrayLabels: (labels: Record<string, string>) => invoke<void>("set_tray_labels", { labels }),

  exportBackup: (path: string) => invoke<void>("export_backup", { path }),
  importBackup: (path: string) => invoke<void>("import_backup", { path }),

  startSession: (topicId: string, templateId: string | null, config: TimerConfig) =>
    invoke<TimerSnapshot>("start_session", { topicId, templateId, config }),
  unfinishedSession: () => invoke<Session | null>("unfinished_session"),
  resumeSession: (sessionId: string) => invoke<TimerSnapshot>("resume_session", { sessionId }),
  closeUnfinished: (sessionId: string) => invoke<void>("close_unfinished", { sessionId }),
  timerState: () => invoke<TimerSnapshot | null>("timer_state"),
  togglePause: () => invoke<void>("timer_toggle_pause"),
  skipBlock: () => invoke<void>("timer_skip"),
  finishSession: () => invoke<string | null>("finish_session"),
  rateSession: (sessionId: string, rating: number) => invoke<void>("rate_session", { sessionId, rating }),
  saveSessionNotes: (sessionId: string, notes: string) =>
    invoke<void>("save_session_notes", { sessionId, notes }),
  toggleMini: () => invoke<boolean>("toggle_mini"),
  showMain: () => invoke<void>("show_main"),
  /** Opens http(s)/mailto/tel links in the default browser (never inside the app window). */
  openExternal: (url: string) => invoke<void>("open_external", { url }),

  listActivities: () => invoke<BreakActivity[]>("list_activities"),
  saveActivity: (activity: Partial<BreakActivity>) =>
    invoke<BreakActivity>("save_activity", {
      activity: { id: "", emoji: "⭐", name: "", instructions: "", sort: 0, ...activity },
    }),
  deleteActivity: (id: string) => invoke<void>("delete_activity", { id }),

  savePlanned: (plan: PlannedStudy) => invoke<PlannedStudy>("save_planned", { plan: { created_at: "", ...plan } }),
  getPlanned: (id: string) => invoke<PlannedStudy>("get_planned", { id }),
  deletePlanned: (id: string) => invoke<void>("delete_planned", { id }),
  plannedOccurrences: (from: string, to: string) => invoke<PlannedOccurrence[]>("planned_occurrences", { from, to }),
  upcomingExams: () => invoke<Exam[]>("upcoming_exams"),

  listQuickNotes: (topicId: string) => invoke<Session[]>("list_quick_notes", { topicId }),
  searchQuickNotes: (query: string) => invoke<QuickNoteHit[]>("search_quick_notes", { query }),
  moveQuickNote: (sessionId: string, target: string | null, title: string, heading: string) =>
    invoke<Note>("move_quick_note", { sessionId, target, title, heading }),

  spellLanguages: () => invoke<string[]>("spell_languages"),
  spellCheck: (words: string[], langs: string[]) => invoke<boolean[]>("spell_check", { words, langs }),
  spellSuggest: (word: string, langs: string[]) => invoke<string[]>("spell_suggest", { word, langs }),
  dictionaryWords: () => invoke<string[]>("dictionary_words"),
  dictionaryAdd: (word: string) => invoke<void>("dictionary_add", { word }),
  dictionaryRemove: (word: string) => invoke<void>("dictionary_remove", { word }),

  setSecret: (key: SecretKey, value: string) => invoke<void>("set_secret", { key, value }),
  secretsStatus: () => invoke<Record<SecretKey, boolean>>("secrets_status"),
  phoneTest: (channel: PhoneChannel, title: string, body: string) => invoke<void>("phone_test", { channel, title, body }),
  phoneNotify: (event: "block", title: string, body: string) => invoke<void>("phone_notify", { event, title, body }),
  telegramFindChat: () => invoke<string>("telegram_find_chat"),

  clearQuickNotes: (ids: string[]) => invoke<void>("clear_quick_notes", { ids }),

  /** Copies bytes (pasted image/video) into the attachments folder; returns the file name. */
  saveAttachment: (name: string, bytes: Uint8Array) =>
    invoke<string>("save_attachment", bytes, { headers: { "x-name": encodeURIComponent(name) } }),
  importAttachment: (path: string) => invoke<string>("import_attachment", { path }),
  attachmentsDir: () => invoke<string>("attachments_dir"),

  toolsStatus: () => invoke<ToolsStatus>("tools_status"),
  latexInstall: () => invoke<void>("latex_install"),
  latexUninstall: () => invoke<void>("latex_uninstall"),
  latexCompile: (noteId: string, source: string) => invoke<LatexResult>("latex_compile", { noteId, source }),
  latexExport: (noteId: string, dest: string) => invoke<void>("latex_export", { noteId, dest }),
  dictationModels: () => invoke<WhisperModel[]>("dictation_models"),
  dictationInstall: (id: string) => invoke<void>("dictation_install", { id }),
  dictationUninstall: () => invoke<void>("dictation_uninstall"),
  /** `device`: microphone name ("" = Windows default). */
  dictationStart: (device: string) => invoke<void>("dictation_start", { device }),
  dictationDevices: () => invoke<string[]>("dictation_devices"),
  dictationStop: (lang: string) => invoke<string>("dictation_stop", { lang }),
  dictationCancel: () => invoke<void>("dictation_cancel"),
};

export const DEFAULT_SHORTCUT = "CommandOrControl+Alt+Shift+K";
