// Native save/confirm dialogs. The e2e test can't click native dialogs, so it may set
// `window.__e2eDialogs` to answer them (never set in normal use).
import { ask as nativeAsk, save as nativeSave } from "@tauri-apps/plugin-dialog";

type Hooks = { save?: string | null; ask?: boolean };
const hooks = () => (window as unknown as { __e2eDialogs?: Hooks }).__e2eDialogs;

export const save: typeof nativeSave = (options) => {
  const h = hooks();
  return h && "save" in h ? Promise.resolve(h.save ?? null) : nativeSave(options);
};

export const ask: typeof nativeAsk = (message, options) => {
  const h = hooks();
  return h && "ask" in h ? Promise.resolve(!!h.ask) : nativeAsk(message, options);
};
