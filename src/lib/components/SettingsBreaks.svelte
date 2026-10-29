<script lang="ts">
  import { ask } from "@tauri-apps/plugin-dialog";
  import { api, type BreakActivity } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { t } from "$lib/i18n/i18n.svelte";
  import { TEMPLATES } from "$lib/templates";
  import BreakPlanEditor from "./BreakPlanEditor.svelte";

  let method = $state(TEMPLATES[0].id);
  let plan = $state<string[]>([]);
  let editing = $state<Partial<BreakActivity> | null>(null);

  $effect(() => {
    plan = app.breakPlan(method);
  });

  async function save() {
    if (!editing?.name?.trim()) return;
    try {
      await api.saveActivity({ ...editing, name: editing.name.trim(), emoji: editing.emoji?.trim() || "⭐" });
      editing = null;
      await app.reloadActivities();
    } catch (e) {
      app.fail(e);
    }
  }

  async function remove(a: BreakActivity) {
    if (!(await ask(t("breaks.delete_confirm", { name: a.name }), { kind: "warning" }))) return;
    await api.deleteActivity(a.id).catch(app.fail.bind(app));
    await app.reloadActivities();
  }
</script>

<div class="card block">
  <div class="row">
    <div class="grow">
      <div>{t("breaks.activities")}</div>
      <span class="faint">{t("breaks.activities_hint")}</span>
    </div>
    <button class="btn" onclick={() => (editing = { emoji: "⭐", name: "", instructions: "" })}>{t("breaks.new")}</button>
  </div>
  <div class="list">
    {#each app.activities as a (a.id)}
      {#if editing?.id === a.id}{@render form()}{:else}
        <div class="row act">
          <span class="emoji">{a.emoji}</span>
          <div class="grow">
            <strong>{a.name}</strong>
            {#if a.instructions}<p class="faint">{a.instructions}</p>{/if}
          </div>
          <button class="btn ghost" onclick={() => (editing = { ...a })}>{t("common.edit")}</button>
          <button class="btn ghost danger" onclick={() => remove(a)}>{t("common.delete")}</button>
        </div>
      {/if}
    {/each}
    {#if editing && !editing.id}{@render form()}{/if}
  </div>
</div>

<div class="card block">
  <div>{t("breaks.default_plan")}</div>
  <span class="faint">{t("breaks.default_plan_hint")}</span>
  <label class="field">
    {t("breaks.method")}
    <select bind:value={method}>
      {#each TEMPLATES as tp}<option value={tp.id}>{tp.icon} {t(`templates.${tp.id}.name`)}</option>{/each}
    </select>
  </label>
  <p class="faint guide">{t(`templates.${method}.break_guide`)}</p>
  <BreakPlanEditor bind:plan onchange={(p) => app.setBreakPlan(method, p)} />
</div>

{#snippet form()}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); save(); }}>
    <div class="row">
      <label class="field emoji-field">{t("breaks.emoji")}<input type="text" maxlength="4" bind:value={editing!.emoji} /></label>
      <label class="field grow">{t("breaks.name")}<input type="text" bind:value={editing!.name} /></label>
    </div>
    <label class="field">{t("breaks.instructions")}<textarea rows="2" bind:value={editing!.instructions}></textarea></label>
    <div class="row">
      <span class="grow"></span>
      <button type="button" class="btn" onclick={() => (editing = null)}>{t("common.cancel")}</button>
      <button class="btn primary" disabled={!editing?.name?.trim()}>{t("common.save")}</button>
    </div>
  </form>
{/snippet}

<style>
  .block { display: grid; gap: 10px; padding: 14px 16px; }
  .list { display: grid; gap: 2px; }
  .act { padding: 6px 0; border-top: 1px solid var(--stroke); }
  .emoji { font-size: 22px; width: 32px; text-align: center; }
  .edit { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--accent); border-radius: var(--radius); }
  .emoji-field { width: 76px; flex: none; }
  .guide { padding: 8px 10px; border-radius: var(--radius-sm); background: var(--break-soft); }
</style>
