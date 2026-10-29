// Minimal i18n: nested JSON dictionaries + `t("a.b.c", { n: 3 })`.
// To add a language, create `xx.json` with the same keys and register it in LOCALES.
import es from "./es.json";

type Dict = { [k: string]: unknown };

export const LOCALES: Record<string, { label: string; dict: Dict }> = {
  es: { label: "Español", dict: es as unknown as Dict },
};

let current = $state("es");

export const i18n = {
  get locale() {
    return current;
  },
  set locale(l: string) {
    if (LOCALES[l]) current = l;
  },
};

function lookup(key: string): unknown {
  let node: unknown = LOCALES[current].dict;
  for (const part of key.split(".")) {
    if (node && typeof node === "object") node = (node as Dict)[part];
    else return undefined;
  }
  return node;
}

export function t(key: string, params: Record<string, string | number> = {}): string {
  const v = lookup(key);
  if (typeof v !== "string") return key;
  return v.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
}

/** Structured value (objects/arrays) for content such as the Markdown guide. */
export function tRaw<T = unknown>(key: string): T {
  return lookup(key) as T;
}

export function tList(key: string): string[] {
  const v = lookup(key);
  return Array.isArray(v) ? v : [];
}
