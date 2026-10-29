<script lang="ts">
  import { api, type Subject } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { SUBJECT_COLORS, SUBJECT_ICONS } from "$lib/format";
  import { t } from "$lib/i18n/i18n.svelte";
  import Modal from "./Modal.svelte";

  let {
    subject,
    onclose,
    onsaved,
  }: { subject: Partial<Subject>; onclose: () => void; onsaved: (s: Subject) => void } = $props();

  // Form starts from the subject passed in; edits stay local until saved.
  // svelte-ignore state_referenced_locally
  let name = $state(subject.name ?? "");
  // svelte-ignore state_referenced_locally
  let color = $state(subject.color ?? SUBJECT_COLORS[0]);
  // svelte-ignore state_referenced_locally
  let icon = $state(subject.icon ?? SUBJECT_ICONS[0]);

  async function save() {
    if (!name.trim()) return;
    try {
      onsaved(await api.saveSubject({ ...subject, name: name.trim(), color, icon }));
    } catch (e) {
      app.fail(e);
    }
  }
</script>

<Modal title={subject.id ? t("common.edit") : t("subjects.new")} {onclose}>
  <form id="subject-form" onsubmit={(e) => { e.preventDefault(); save(); }} class="form">
    <label class="field">
      {t("subjects.name")}
      <!-- svelte-ignore a11y_autofocus -->
      <input type="text" bind:value={name} autofocus />
    </label>
    <div class="field">
      {t("subjects.color")}
      <div class="swatches">
        {#each SUBJECT_COLORS as c}
          <button type="button" class="swatch" class:on={c === color} style:background={c} aria-label={c} onclick={() => (color = c)}></button>
        {/each}
      </div>
    </div>
    <div class="field">
      {t("subjects.icon")}
      <div class="swatches">
        {#each SUBJECT_ICONS as i}
          <button type="button" class="emoji" class:on={i === icon} onclick={() => (icon = i)}>{i}</button>
        {/each}
      </div>
    </div>
  </form>
  {#snippet footer()}
    <button class="btn" onclick={onclose}>{t("common.cancel")}</button>
    <button class="btn primary" form="subject-form" disabled={!name.trim()}>{t("common.save")}</button>
  {/snippet}
</Modal>

<style>
  .form { display: grid; gap: 16px; }
  .field { display: grid; gap: 8px; font-size: 13px; color: var(--text-2); }
  .swatches { display: flex; flex-wrap: wrap; gap: 6px; }
  .swatch { width: 28px; height: 28px; border-radius: 50%; border: 2px solid transparent; outline: 2px solid transparent; }
  .swatch.on { outline-color: var(--text); border-color: var(--layer-solid); }
  .emoji { width: 36px; height: 36px; border-radius: 8px; border: 1px solid var(--stroke); background: var(--card); font-size: 18px; }
  .emoji.on { border-color: var(--accent); background: var(--accent-soft); }
</style>
