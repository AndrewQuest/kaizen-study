<script lang="ts">
  // Ordered list of activities for consecutive breaks (the timer cycles through it).
  import { api } from "$lib/api";
  import { app, tmpActivityId, TMP_ACTIVITY } from "$lib/app.svelte";
  import { t } from "$lib/i18n/i18n.svelte";

  let {
    plan = $bindable<string[]>([]),
    onchange,
    allowCustom = false,
  }: { plan?: string[]; onchange?: (plan: string[]) => void; allowCustom?: boolean } = $props();

  let custom = $state<{ emoji: string; name: string; instructions: string; save: boolean } | null>(null);

  function update(next: string[]) {
    plan = next;
    onchange?.(next);
  }

  async function addCustom(e: SubmitEvent) {
    e.preventDefault();
    if (!custom?.name.trim()) return;
    const data = { emoji: custom.emoji.trim() || "⭐", name: custom.name.trim(), instructions: custom.instructions.trim() };
    try {
      let id: string;
      if (custom.save) {
        id = (await api.saveActivity(data)).id;
        await app.reloadActivities();
      } else {
        id = tmpActivityId(data);
      }
      update([...plan, id]);
      custom = null;
    } catch (err) {
      app.fail(err);
    }
  }
</script>

<div class="plan">
  {#each plan as id, i (i)}
    <div class="row slot">
      <span class="faint n">{t("breaks.slot", { n: i + 1 })}</span>
      {#if id.startsWith(TMP_ACTIVITY)}
        {@const a = app.activity(id)}
        <span class="grow tmp">{a?.emoji} {a?.name} <span class="faint">({t("breaks.session_only")})</span></span>
      {:else}
        <select class="grow" value={id} aria-label={t("breaks.slot", { n: i + 1 })}
          onchange={(e) => update(plan.map((x, j) => (j === i ? e.currentTarget.value : x)))}>
          {#each app.activities as a (a.id)}<option value={a.id}>{a.emoji} {a.name}</option>{/each}
        </select>
      {/if}
      <button class="btn ghost icon" title={t("breaks.remove")} aria-label={t("breaks.remove")}
        onclick={() => update(plan.filter((_, j) => j !== i))}>✕</button>
    </div>
  {/each}
  <div class="row">
    {#if app.activities.length}
      <button class="btn ghost add" onclick={() => update([...plan, app.activities[plan.length % app.activities.length].id])}>
        {t("breaks.add")}
      </button>
    {/if}
    {#if allowCustom && !custom}
      <button class="btn ghost add" onclick={() => (custom = { emoji: "⭐", name: "", instructions: "", save: true })}>
        {t("breaks.custom")}
      </button>
    {/if}
  </div>
  {#if custom}
    <form class="custom" onsubmit={addCustom}>
      <strong>{t("breaks.custom_title")}</strong>
      <div class="row">
        <label class="field emoji">{t("breaks.emoji")}<input type="text" maxlength="4" bind:value={custom.emoji} /></label>
        <label class="field grow">{t("breaks.name")}<input type="text" bind:value={custom.name} /></label>
      </div>
      <label class="field">{t("breaks.instructions")}<input type="text" bind:value={custom.instructions} /></label>
      <div class="row">
        <label class="row grow"><input type="checkbox" bind:checked={custom.save} /> {t("breaks.custom_save")}</label>
        <button type="button" class="btn" onclick={() => (custom = null)}>{t("common.cancel")}</button>
        <button class="btn primary" disabled={!custom.name.trim()}>{t("breaks.custom_add")}</button>
      </div>
    </form>
  {/if}
</div>

<style>
  .plan { display: grid; gap: 6px; }
  .n { width: 80px; flex: none; }
  .add { color: var(--accent); }
  .tmp { padding: 5px 10px; border: 1px dashed var(--stroke-strong); border-radius: var(--radius-sm); }
  .custom { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--accent); border-radius: var(--radius); }
  .emoji { width: 76px; flex: none; }
</style>
