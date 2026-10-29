<script lang="ts">
  import { ask } from "@tauri-apps/plugin-dialog";
  import { api, type PlannedStudy, type Subject, type Topic } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { t, tList } from "$lib/i18n/i18n.svelte";
  import { TEMPLATES } from "$lib/templates";
  import Modal from "./Modal.svelte";

  let { plan, onclose, onsaved }: { plan: PlannedStudy; onclose: () => void; onsaved: () => void } = $props();

  // svelte-ignore state_referenced_locally
  let draft = $state<PlannedStudy>({ ...plan });
  // svelte-ignore state_referenced_locally
  let repeat = $state(plan.repeat_days !== "");
  let groups = $state<{ subject: Subject; topics: Topic[] }[]>([]);
  let busy = $state(false);
  let loaded = $state(false);
  const days = $derived(new Set(draft.repeat_days.split(",").filter(Boolean)));
  const weekdays = tList("calendar.weekdays_long");

  (async () => {
    const subjects = await api.listSubjects();
    groups = await Promise.all(subjects.map(async (subject) => ({ subject, topics: await api.listTopics(subject.id) })));
    if (!draft.topic_id) draft.topic_id = groups.find((g) => g.topics.length)?.topics[0].id ?? "";
    loaded = true;
  })();

  function toggleDay(d: string, on: boolean) {
    const next = new Set(days);
    if (on) next.add(d);
    else next.delete(d);
    draft.repeat_days = [...next].sort().join(",");
  }

  async function save() {
    busy = true;
    try {
      await api.savePlanned({
        ...draft,
        duration_min: Math.round(Number(draft.duration_min) || 60),
        repeat_days: repeat ? draft.repeat_days : "",
        repeat_until: repeat && draft.repeat_until ? draft.repeat_until : null,
      });
      onsaved();
    } catch (e) {
      app.fail(e);
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!(await ask(t("calendar.delete_confirm"), { kind: "warning" }))) return;
    try {
      await api.deletePlanned(draft.id);
    } catch (e) {
      return app.fail(e);
    }
    onsaved();
  }

  const valid = $derived(!!draft.topic_id && !!draft.start_date && /^\d\d:\d\d$/.test(draft.time) && (!repeat || days.size > 0));
</script>

<Modal title={draft.id ? t("calendar.edit_title") : t("calendar.plan_title")} {onclose} width={520}>
  {#if loaded && !groups.some((g) => g.topics.length)}
    <p class="muted">{t("calendar.need_topic")}</p>
  {:else}
    <label class="field">
      {t("calendar.topic")}
      <select bind:value={draft.topic_id}>
        {#each groups as g (g.subject.id)}
          {#if g.topics.length}
            <optgroup label="{g.subject.icon} {g.subject.name}">
              {#each g.topics as tp (tp.id)}<option value={tp.id}>{tp.name}</option>{/each}
            </optgroup>
          {/if}
        {/each}
      </select>
    </label>
    <div class="grid3">
      <label class="field">{t("calendar.date")}<input type="date" bind:value={draft.start_date} /></label>
      <label class="field">{t("calendar.time")}<input type="time" bind:value={draft.time} /></label>
      <label class="field">{t("calendar.duration")}<input type="number" min="5" max="720" step="5" bind:value={draft.duration_min} /></label>
    </div>
    <label class="field">
      {t("calendar.method")}
      <select value={draft.template_id ?? ""} onchange={(e) => (draft.template_id = e.currentTarget.value || null)}>
        <option value="">{t("calendar.any_method")}</option>
        {#each TEMPLATES as tp}<option value={tp.id}>{tp.icon} {t(`templates.${tp.id}.name`)}</option>{/each}
      </select>
    </label>
    <label class="row"><input type="checkbox" bind:checked={repeat} /> 🔁 {t("calendar.repeat")}</label>
    {#if repeat}
      <div class="days" role="group" aria-label={t("calendar.repeat_days")}>
        {#each weekdays as name, i}
          {@const d = String(i + 1)}
          <label class="day" class:on={days.has(d)} title={name}>
            <input type="checkbox" checked={days.has(d)} onchange={(e) => toggleDay(d, e.currentTarget.checked)} />
            {name.slice(0, 2)}
          </label>
        {/each}
      </div>
      <label class="field">{t("calendar.repeat_until")}
        <input type="date" value={draft.repeat_until ?? ""} onchange={(e) => (draft.repeat_until = e.currentTarget.value || null)} />
      </label>
    {/if}
  {/if}
  {#snippet footer()}
    {#if draft.id}<button class="btn danger" onclick={remove}>{t("calendar.delete")}</button>{/if}
    <span class="grow"></span>
    <button class="btn" onclick={onclose}>{t("common.cancel")}</button>
    <button class="btn primary" disabled={busy || !valid} onclick={save}>{t("common.save")}</button>
  {/snippet}
</Modal>

<style>
  .grid3 { display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: 10px; }
  .days { display: flex; gap: 6px; }
  .day {
    flex: 1; display: grid; place-items: center; height: 34px; border-radius: var(--radius-sm);
    border: 1px solid var(--stroke-strong); cursor: pointer; font-weight: 600; font-size: 13px;
  }
  .day input { position: absolute; opacity: 0; pointer-events: none; }
  .day.on { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
</style>
