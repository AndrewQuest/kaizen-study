<script lang="ts">
  import { api } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { t } from "$lib/i18n/i18n.svelte";

  let languages = $state<string[]>([]);
  let words = $state<string[]>([]);
  const active = $derived(app.settings.spell_langs.split(",").filter(Boolean));

  api.spellLanguages().then((l) => (languages = l));
  const loadWords = () => api.dictionaryWords().then((w) => (words = w));
  loadWords();

  function toggleLang(code: string, on: boolean) {
    const next = on ? [...active, code] : active.filter((c) => c !== code);
    app.setSetting("spell_langs", languages.filter((l) => next.includes(l)).join(","));
  }

  async function removeWord(w: string) {
    await api.dictionaryRemove(w);
    await loadWords();
  }
</script>

<div class="card setting">
  <div class="grow">{t("settings.spell_enabled")}</div>
  <input type="checkbox" class="toggle" checked={app.settings.spell_enabled}
    onchange={(e) => app.setSetting("spell_enabled", e.currentTarget.checked)} />
</div>
<div class="card block">
  <div>{t("settings.spell_langs")}</div>
  <span class="faint">{t("settings.spell_langs_hint")}</span>
  <div class="row langs">
    {#each languages as code}
      <label class="row"><input type="checkbox" checked={active.includes(code)} onchange={(e) => toggleLang(code, e.currentTarget.checked)} />
        {t(`settings.lang_${code}`)}</label>
    {/each}
  </div>
</div>
<div class="card block">
  <div>{t("settings.dictionary")}</div>
  {#if words.length}
    <div class="words">
      {#each words as w}
        <span class="chip">{w}<button class="x" aria-label="{t('common.delete')} {w}" onclick={() => removeWord(w)}>✕</button></span>
      {/each}
    </div>
  {:else}
    <span class="faint">{t("settings.dictionary_empty")}</span>
  {/if}
</div>

<style>
  .setting { display: flex; align-items: center; gap: 12px; padding: 14px 16px; flex-wrap: wrap; }
  .block { display: grid; gap: 8px; padding: 14px 16px; }
  .langs { gap: 20px; }
  .words { display: flex; flex-wrap: wrap; gap: 6px; }
  .x { border: 0; background: none; color: var(--text-3); padding: 0 0 0 4px; }
  .x:hover { color: var(--danger); }
</style>
