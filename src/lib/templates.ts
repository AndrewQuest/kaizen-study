// Built-in study-method templates. Texts live in i18n under `templates.<id>`.
import type { NoteLayout, TimerConfig, Topic } from "./api";

export interface StudyTemplate {
  id: string;
  /** Emoji shown on the method card (flag emojis do not render on Windows). */
  icon: string;
  timer: TimerConfig;
  noteLayout: NoteLayout;
  /** "leitner": spaced reviews after each session; "examen": 7-3-2-1 before an exam date. */
  reviews: "leitner" | "examen" | null;
  /** Adapts the timer to the topic's history (e.g. Kaizen grows each session). */
  adapt?: (cfg: TimerConfig, topic: Topic) => TimerConfig;
}

const intervals = (focus: number, brk: number, long = 0, every = 0, spaced = false): TimerConfig => ({
  mode: "intervals",
  focus_min: focus,
  break_min: brk,
  long_break_min: long,
  long_every: every,
  flow_ratio: 5,
  spaced,
  break_plan: [],
});

export const TEMPLATES: StudyTemplate[] = [
  { id: "pomodoro", icon: "🍅", timer: intervals(25, 5, 15, 4), noteLayout: "libre", reviews: null },
  { id: "5217", icon: "⏳", timer: intervals(52, 17), noteLayout: "libre", reviews: null },
  {
    id: "flowtime",
    icon: "🌊",
    timer: { ...intervals(0, 0), mode: "flow", flow_ratio: 5 },
    noteLayout: "libre",
    reviews: null,
  },
  {
    id: "kaizen",
    icon: "🌱",
    timer: intervals(10, 5),
    noteLayout: "libre",
    reviews: null,
    adapt: (cfg, topic) => ({ ...cfg, focus_min: Math.min(50, 10 + 5 * topic.session_count) }),
  },
  { id: "shuhari", icon: "🥋", timer: intervals(25, 5, 15, 4, true), noteLayout: "libre", reviews: "leitner" },
  { id: "feynman", icon: "💡", timer: intervals(25, 5, 15, 4, true), noteLayout: "feynman", reviews: "leitner" },
  { id: "cornell", icon: "📓", timer: intervals(30, 5, 15, 3, true), noteLayout: "cornell", reviews: "leitner" },
  { id: "leitner", icon: "🗂️", timer: intervals(25, 5, 15, 4, true), noteLayout: "preguntas", reviews: "leitner" },
  { id: "7321", icon: "📅", timer: intervals(25, 5, 15, 4), noteLayout: "libre", reviews: "examen" },
  { id: "ipsi", icon: "📚", timer: intervals(50, 10, 30, 3), noteLayout: "libre", reviews: null },
];

export const templateById = (id: string | null | undefined) => TEMPLATES.find((t) => t.id === id);

export function timerFor(tpl: StudyTemplate, topic: Topic): TimerConfig {
  return tpl.adapt ? tpl.adapt(tpl.timer, topic) : tpl.timer;
}

/** Starter Markdown for each note layout (headings are translated by the caller). */
export function noteSkeleton(layout: NoteLayout, h: (k: string) => string): string {
  switch (layout) {
    case "cornell":
      return `## ${h("notes.cornell.cues")}\n\n- \n\n## ${h("notes.cornell.notes")}\n\n\n\n## ${h("notes.cornell.summary")}\n\n`;
    case "feynman":
      return `## ${h("notes.feynman.concept")}\n\n\n\n## ${h("notes.feynman.simple")}\n\n\n\n## ${h("notes.feynman.gaps")}\n\n- \n\n## ${h("notes.feynman.analogy")}\n\n`;
    case "preguntas":
      return `## ${h("notes.questions.title")}\n\n**P:** \n**R:** \n\n**P:** \n**R:** \n`;
    case "latexdoc":
      // The minimum a LaTeX document needs to compile.
      return "\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n";
    default:
      return "";
  }
}
