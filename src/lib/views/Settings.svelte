<script lang="ts">
  import { ask, open, save } from "@tauri-apps/plugin-dialog";
  import { api, DEFAULT_SHORTCUT } from "$lib/api";
  import { app, playChime } from "$lib/app.svelte";
  import { isoDate } from "$lib/format";
  import { LOCALES, t } from "$lib/i18n/i18n.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import SettingsCleanup from "$lib/components/SettingsCleanup.svelte";
  import SettingsBreaks from "$lib/components/SettingsBreaks.svelte";
  import SettingsPhone from "$lib/components/SettingsPhone.svelte";
  import SettingsSpell from "$lib/components/SettingsSpell.svelte";
  import SettingsTools from "$lib/components/SettingsTools.svelte";

  let recording = $state(false);
  /** 80 % – 200 % in 10 % steps. */
  const SCALES = Array.from({ length: 13 }, (_, i) => Math.round((0.8 + i * 0.1) * 10) / 10);
  let pendingDir = $state<string | null>(null);
  // Derived: settings are replaced after importing a backup or switching data folder.
  const s = $derived(app.settings);

  const prettyShortcut = (sc: string) => sc.replace("CommandOrControl", "Ctrl").replaceAll("+", " + ");

  function record(e: KeyboardEvent) {
    if (!recording) return;
    e.preventDefault();
    if (e.key === "Escape") return (recording = false);
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
    const mods = [e.ctrlKey && "CommandOrControl", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean);
    if (!mods.length) return; // a global shortcut without modifiers would hijack normal typing
    const key = e.code.replace(/^Key/, "").replace(/^Digit/, "");
    recording = false;
    applyShortcut([...mods, key].join("+"));
  }

  async function applyShortcut(sc: string) {
    try {
      await api.setShortcut(sc);
      app.settings.shortcut = sc;
      app.info = await api.appInfo();
      app.notify(t("common.saved"));
    } catch {
      app.notify(t("settings.shortcut_error"), true);
    }
  }

  async function pickDir() {
    const dir = await open({ directory: true, title: t("setup.dialog_title") });
    if (dir) pendingDir = dir;
  }

  async function changeDir(mode: "open" | "move") {
    const dir = pendingDir!;
    pendingDir = null;
    try {
      await api.setDataDir(dir, mode);
      app.info = await api.appInfo();
      await app.loadSettings();
      app.refresh();
      app.notify(t("common.saved"));
    } catch (e) {
      app.fail(e);
    }
  }

  async function exportBackup() {
    const path = await save({
      defaultPath: `kaizen-study-${isoDate()}.kaizen`,
      filters: [{ name: "Kaizen Study", extensions: ["kaizen"] }],
    });
    if (!path) return;
    await api.exportBackup(path).then(() => app.notify(t("settings.export_done")), app.fail.bind(app));
  }

  async function importBackup() {
    const path = await open({ filters: [{ name: "Kaizen Study", extensions: ["kaizen"] }] });
    if (!path || !(await ask(t("settings.import_confirm"), { kind: "warning" }))) return;
    try {
      await api.importBackup(path);
      await app.loadSettings();
      app.refresh();
      app.notify(t("settings.import_done"));
    } catch (e) {
      app.fail(e);
    }
  }
</script>

<svelte:window onkeydown={record} />

<div class="page">
  <div class="page-head"><h1>{t("settings.title")}</h1></div>

  <section>
    <h3>{t("settings.data")}</h3>
    <div class="card setting">
      <div class="grow">
        <div>{t("settings.data_dir")}</div>
        <code class="faint">{app.info?.data_dir}</code>
      </div>
      <button class="btn" onclick={pickDir}>{t("settings.change_dir")}</button>
    </div>
    <div class="card setting">
      <div class="grow">
        <div>{t("settings.backup")}</div>
        <span class="faint">{t("settings.auto_backup")}</span>
      </div>
      <button class="btn" onclick={exportBackup}>{t("settings.export")}</button>
      <button class="btn" onclick={importBackup}>{t("settings.import")}</button>
    </div>
    <SettingsCleanup />
  </section>

  <section>
    <h3>{t("settings.appearance")}</h3>
    <div class="card setting">
      <div class="grow">{t("settings.theme")}</div>
      <select value={s.theme} onchange={(e) => app.setSetting("theme", e.currentTarget.value as any)}>
        {#each ["system", "light", "dark"] as th}<option value={th}>{t(`settings.theme_${th}`)}</option>{/each}
      </select>
    </div>
    <div class="card setting">
      <div class="grow">{t("settings.language")}</div>
      <select value={s.locale} onchange={(e) => app.setSetting("locale", e.currentTarget.value)}>
        {#each Object.entries(LOCALES) as [code, l]}<option value={code}>{l.label}</option>{/each}
      </select>
    </div>
    <div class="card setting">
      <div class="grow">
        <div>{t("settings.ui_scale")}</div>
        <span class="faint">{t("settings.ui_scale_hint")}</span>
      </div>
      <select aria-label={t("settings.ui_scale")} value={String(s.ui_scale)}
        onchange={(e) => app.setSetting("ui_scale", Number(e.currentTarget.value))}>
        {#each SCALES as v}<option value={String(v)}>{Math.round(v * 100)} %</option>{/each}
      </select>
    </div>
  </section>

  <section>
    <h3>{t("settings.timer")}</h3>
    <div class="card setting">
      <div class="grow">{t("settings.sound")}</div>
      {#if s.sound}
        <span class="faint">{t("settings.volume")}</span>
        <input type="range" min="0" max="1" step="0.05" value={s.volume}
          onchange={(e) => app.setSetting("volume", Number(e.currentTarget.value))} />
        <button class="btn" onclick={() => playChime(s.volume)}>🔔 {t("settings.test_sound")}</button>
      {/if}
      <input type="checkbox" class="toggle" checked={s.sound} onchange={(e) => app.setSetting("sound", e.currentTarget.checked)} />
    </div>
    <div class="card setting">
      <div class="grow">{t("settings.daily_goal")}</div>
      <input class="goal" type="number" min="10" max="960" step="10" value={s.daily_goal_min}
        onchange={(e) => {
          const v = Math.min(960, Math.max(10, Math.round(Number(e.currentTarget.value) || 120)));
          e.currentTarget.value = String(v);
          app.setSetting("daily_goal_min", v);
        }} />
    </div>
    <div class="card setting">
      <div class="grow">{t("settings.notifications")}</div>
      <input type="checkbox" class="toggle" checked={s.notifications} onchange={(e) => app.setSetting("notifications", e.currentTarget.checked)} />
    </div>
    <div class="card setting">
      <div class="grow">{t("settings.shortcut")}</div>
      <kbd>{recording ? t("settings.shortcut_press") : prettyShortcut(s.shortcut)}</kbd>
      <button class="btn" class:primary={recording} onclick={() => (recording = !recording)}>{t("settings.shortcut_record")}</button>
      {#if s.shortcut !== DEFAULT_SHORTCUT}
        <button class="btn ghost" onclick={() => applyShortcut(DEFAULT_SHORTCUT)}>{t("settings.shortcut_reset")}</button>
      {/if}
    </div>
  </section>

  <section>
    <h3>{t("settings.editor")}</h3>
    <div class="card setting">
      <div class="grow">
        <div>{t("settings.editor_mode")}</div>
        <span class="faint">{t("settings.editor_mode_hint")}</span>
      </div>
      <select value={s.editor_mode} onchange={(e) => app.setSetting("editor_mode", e.currentTarget.value as "hybrid" | "split")}>
        <option value="hybrid">{t("editor.mode_hybrid")}</option>
        <option value="split">{t("editor.mode_split")}</option>
      </select>
    </div>
  </section>

  <section>
    <h3>{t("settings.latex")}</h3>
    <SettingsTools section="latex" />
  </section>

  <section>
    <h3>{t("dictation.title")}</h3>
    <SettingsTools section="dictation" />
  </section>

  <section>
    <h3>{t("breaks.title")}</h3>
    <SettingsBreaks />
  </section>

  <section>
    <h3>{t("settings.spell")}</h3>
    <SettingsSpell />
  </section>

  <section>
    <h3>{t("settings.phone")}</h3>
    <SettingsPhone />
  </section>

  <section>
    <h3>{t("settings.general")}</h3>
    <div class="card setting">
      <div class="grow">
        <div>{t("settings.autostart")}</div>
        <span class="faint">{t("settings.autostart_hint")}</span>
      </div>
      <input type="checkbox" class="toggle" checked={s.autostart} onchange={(e) => app.setSetting("autostart", e.currentTarget.checked)} />
    </div>
  </section>

  <section>
    <h3>{t("settings.about")}</h3>
    <div class="card setting">
      <div class="grow">Kaizen Study</div>
      <span class="faint">{t("settings.version", { v: app.info?.version ?? "" })}</span>
    </div>
  </section>
</div>

{#if pendingDir}
  <Modal title={t("settings.move_or_open")} onclose={() => (pendingDir = null)}>
    <code class="faint">{pendingDir}</code>
    <button class="btn choice" onclick={() => changeDir("move")}>📦 {t("settings.move")}</button>
    <button class="btn choice" onclick={() => changeDir("open")}>📂 {t("settings.open")}</button>
  </Modal>
{/if}

<style>
  .page { max-width: 900px; margin: 0 auto; }
  section { display: grid; gap: 4px; margin-bottom: 24px; }
  section h3 { margin-bottom: 6px; }
  .setting { display: flex; align-items: center; gap: 12px; padding: 14px 16px; flex-wrap: wrap; }
  .setting > .grow { min-width: 200px; }
  code { word-break: break-all; }
  kbd {
    font-family: var(--mono); font-size: 12px; padding: 4px 8px;
    border: 1px solid var(--stroke-strong); border-bottom-width: 2px; border-radius: 4px; background: var(--subtle);
  }
  .choice { justify-content: flex-start; min-height: 48px; }
  input[type="range"] { accent-color: var(--accent); width: 120px; }
  .goal { width: 100px; }
</style>
