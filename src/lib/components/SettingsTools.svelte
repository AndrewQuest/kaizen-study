<script lang="ts">
  // Optional heavy tools: LaTeX compiler (Tectonic) and dictation models (Whisper).
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { ask } from "@tauri-apps/plugin-dialog";
  import { api, type ToolProgress, type WhisperModel } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { t } from "$lib/i18n/i18n.svelte";

  let { section }: { section: "latex" | "dictation" } = $props();

  let latex = $state(false);
  let models = $state<WhisperModel[]>([]);
  let busy = $state<string | null>(null);
  let progress = $state("");
  let devices = $state<string[]>([]);

  async function loadDevices() {
    devices = await api.dictationDevices().catch(() => []);
  }

  async function load() {
    const s = await api.toolsStatus();
    latex = s.latex;
    models = await api.dictationModels();
  }

  onMount(() => {
    void load();
    if (section === "dictation") void loadDevices();
    const un = listen<ToolProgress>("tools://progress", (e) => {
      const { done, total } = e.payload;
      progress = total ? `${Math.round((done / total) * 100)} %` : `${(done / 1048576).toFixed(0)} MB`;
    });
    return () => void un.then((f) => f());
  });

  async function run(id: string, task: () => Promise<void>) {
    busy = id;
    progress = "";
    try {
      await task();
    } catch (e) {
      app.notify(String(e), true, 8000);
    } finally {
      busy = null;
      await load();
    }
  }

  async function useModel(m: WhisperModel) {
    const current = models.find((x) => x.installed);
    if (current && !(await ask(t("dictation.replace_confirm", { new: m.id, old: current.id }), { kind: "warning" }))) return;
    await run(m.id, () => api.dictationInstall(m.id));
  }

  const dots = (n: number) => "●".repeat(n) + "○".repeat(5 - n);
</script>

{#if section === "latex"}
  <div class="card setting">
    <div class="grow">
      <div>{latex ? `✓ ${t("latex.installed")}` : t("latex.not_installed")}</div>
      <span class="faint">{t("latex.first_run")}</span>
    </div>
    {#if latex}
      <button class="btn danger" disabled={busy !== null} onclick={() => run("latex", api.latexUninstall)}>{t("latex.uninstall")}</button>
    {:else}
      <button class="btn primary" disabled={busy !== null} onclick={() => run("latex", api.latexInstall)}>
        {busy === "latex" ? t("latex.installing", { p: progress }) : t("latex.install")}
      </button>
    {/if}
  </div>
{:else}
  <p class="faint hint">{t("dictation.hint")}</p>
  <div class="card setting">
    <div class="grow">{t("dictation.lang_default")}</div>
    <select value={app.settings.dictation_lang}
      onchange={(e) => app.setSetting("dictation_lang", e.currentTarget.value as "es" | "en" | "auto")}>
      <option value="es">{t("dictation.lang_es")}</option>
      <option value="en">{t("dictation.lang_en")}</option>
      <option value="auto">{t("dictation.lang_auto")}</option>
    </select>
  </div>
  <div class="card setting">
    <div class="grow">{t("dictation.device")}</div>
    <select aria-label={t("dictation.device")} value={app.settings.dictation_device}
      onchange={(e) => app.setSetting("dictation_device", e.currentTarget.value)}>
      <option value="">{t("dictation.device_default")}</option>
      {#each devices as d}<option value={d}>{d}</option>{/each}
      {#if app.settings.dictation_device && !devices.includes(app.settings.dictation_device)}
        <option value={app.settings.dictation_device}>{t("dictation.device_missing", { name: app.settings.dictation_device })}</option>
      {/if}
    </select>
    <button class="btn" onclick={loadDevices}>⟳ {t("dictation.device_refresh")}</button>
  </div>
  <div class="card models">
    <div class="row head faint">
      <span class="grow">{t("dictation.model")}</span>
      <span class="col">{t("dictation.accuracy")}</span>
      <span class="col">{t("dictation.speed")}</span>
      <span class="act"></span>
    </div>
    {#each models as m (m.id)}
      <div class="row model" class:on={m.installed}>
        <div class="grow">
          <strong>{m.id}</strong> <span class="faint">· {t("dictation.size", { n: m.size_mb })}</span>
          <div class="faint">{t(`dictation.models.${m.id}`)}</div>
        </div>
        <span class="col dots">{dots(m.accuracy)}</span>
        <span class="col dots">{dots(m.speed)}</span>
        <span class="act">
          {#if m.installed}
            <span class="chip active">✓ {t("dictation.active")}</span>
            <button class="btn ghost danger" disabled={busy !== null} onclick={() => run(m.id, api.dictationUninstall)}>{t("dictation.remove")}</button>
          {:else}
            <button class="btn" disabled={busy !== null} onclick={() => useModel(m)}>
              {busy === m.id ? t("dictation.downloading", { p: progress }) : t("dictation.use")}
            </button>
          {/if}
        </span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .setting { display: flex; align-items: center; gap: 12px; padding: 14px 16px; flex-wrap: wrap; }
  .setting select { flex: 0 1 auto; min-width: 0; }
  .hint { margin-bottom: 4px; }
  .models { display: grid; gap: 0; padding: 8px 16px; }
  .model { padding: 10px 0; border-top: 1px solid var(--stroke); flex-wrap: wrap; }
  .model > .grow { flex: 1 1 180px; }
  .model.on { background: var(--accent-soft); margin: 0 -16px; padding: 10px 16px; }
  .head { padding: 4px 0; font-size: 12px; }
  .col { width: 76px; text-align: center; }
  .dots { color: var(--accent); letter-spacing: 1px; font-size: 11px; }
  .act { margin-left: auto; display: flex; justify-content: flex-end; gap: 6px; align-items: center; flex-wrap: wrap; }
  .head .act { width: 0; }
  .active { color: var(--break); }
</style>
