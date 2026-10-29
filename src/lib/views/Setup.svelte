<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import { api } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { t } from "$lib/i18n/i18n.svelte";

  let busy = $state(false);

  async function choose() {
    const dir = await open({ directory: true, title: t("setup.dialog_title") });
    if (!dir) return;
    busy = true;
    try {
      await api.setDataDir(dir, "open");
      app.info = await api.appInfo();
      await app.loadSettings();
    } catch (e) {
      app.fail(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="setup">
  <div class="card panel">
    <div class="logo">改</div>
    <h1>{t("setup.title")}</h1>
    <p class="muted">{t("setup.subtitle")}</p>
    <p class="faint">{t("setup.hint")}</p>
    <button class="btn primary big" onclick={choose} disabled={busy}>📁 {t("setup.choose")}</button>
  </div>
</div>

<style>
  .setup { height: 100%; display: grid; place-items: center; padding: 24px; }
  .panel { max-width: 460px; display: grid; gap: 14px; justify-items: center; text-align: center; padding: 40px; }
  .logo {
    width: 64px; height: 64px; border-radius: 16px; display: grid; place-items: center;
    background: var(--accent); color: var(--accent-text); font-size: 34px; font-weight: 700;
  }
</style>
