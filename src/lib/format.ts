import { t } from "./i18n/i18n.svelte";

/** BCP-47 tag used for dates (follows the UI language). */
export const dateLocale = () => t("common.locale_tag");

export const clock = (secs: number) => {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

export const duration = (secs: number) => {
  const m = Math.round(secs / 60);
  return m < 60 ? t("common.minutes", { n: m }) : t("common.hours_short", { h: Math.floor(m / 60), m: m % 60 });
};

/** Local date as YYYY-MM-DD. */
export const isoDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const longDate = (iso: string) =>
  new Date(iso.length === 10 ? iso + "T00:00" : iso).toLocaleDateString(dateLocale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

export const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString(dateLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const SUBJECT_COLORS = ["#0f6cbd", "#c239b3", "#e3008c", "#d13438", "#ca5010", "#c19c00", "#13a10e", "#00b7c3", "#8764b8", "#69797e"];
export const SUBJECT_ICONS = ["📘", "🧮", "🧪", "🌍", "🗣️", "💻", "🎨", "🎵", "📜", "⚖️", "🧠", "💼"];
