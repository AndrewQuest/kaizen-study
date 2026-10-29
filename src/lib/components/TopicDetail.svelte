<script lang="ts">
  import { ask } from "@tauri-apps/plugin-dialog";
  import { api, type Note, type Session, type Topic, type TopicStatus } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { duration, shortDateTime } from "$lib/format";
  import { t } from "$lib/i18n/i18n.svelte";
  import { TEMPLATES, templateById } from "$lib/templates";

  let { id, onback }: { id: string; onback: () => void } = $props();

  let topic = $state<Topic | null>(null);
  let sessions = $state<Session[]>([]);
  let notes = $state<Note[]>([]);

  $effect(() => {
    void app.revision;
    Promise.all([api.getTopic(id), api.listSessions(id), api.listNotes(id)])
      .then(([tp, s, n]) => ([topic, sessions, notes] = [tp, s, n]))
      .catch(app.fail.bind(app));
  });

  async function update(patch: Partial<Topic>) {
    if (!topic) return;
    try {
      topic = await api.saveTopic({ ...topic, ...patch });
      app.refresh();
    } catch (e) {
      app.fail(e);
    }
  }

  let renaming = $state<string | null>(null);

  function rename(e: SubmitEvent) {
    e.preventDefault();
    if (renaming?.trim()) update({ name: renaming.trim() });
    renaming = null;
  }

  async function remove() {
    if (!topic || !(await ask(t("topic.delete_confirm", { name: topic.name }), { kind: "warning" }))) return;
    try {
      await api.deleteTopic(topic.id);
    } catch (e) {
      return app.fail(e);
    }
    onback();
    app.refresh();
  }

  function openNotes() {
    app.notesTopicId = id;
    app.view = "notes";
  }

  const tpl = $derived(templateById(topic?.template_id));
</script>

{#if topic}
  <div class="page">
    <div class="page-head">
      <button class="btn ghost icon" onclick={onback} title={t("common.back")}>←</button>
      {#if renaming !== null}
        <form class="grow row" onsubmit={rename}>
          <!-- svelte-ignore a11y_autofocus -->
          <input class="grow" type="text" bind:value={renaming} autofocus onblur={() => (renaming = null)}
            onkeydown={(e) => e.key === "Escape" && (renaming = null)} />
        </form>
      {:else}
        <h1 class="grow">{topic.name}</h1>
        <button class="btn" onclick={() => (renaming = topic!.name)}>{t("common.edit")}</button>
      {/if}
      <button class="btn danger" onclick={remove}>{t("common.delete")}</button>
      <button class="btn primary" onclick={() => app.openStart(topic!.id)}>▶ {t("topic.study")}</button>
    </div>

    <div class="grid">
      <div class="card props">
        <label class="field">
          {t("topic.status")}
          <select value={topic.status} onchange={(e) => update({ status: e.currentTarget.value as TopicStatus })}>
            {#each ["nuevo", "aprendiendo", "repasando", "dominado"] as s}
              <option value={s}>{t(`topic.status_${s}`)}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          {t("topic.method")}
          <select value={topic.template_id ?? ""} onchange={(e) => update({ template_id: e.currentTarget.value || null })}>
            <option value="">{t("topic.no_method")}</option>
            {#each TEMPLATES as tp}
              <option value={tp.id}>{tp.icon} {t(`templates.${tp.id}.name`)}</option>
            {/each}
          </select>
        </label>
        {#if tpl?.id === "shuhari"}
          <label class="field">
            {t("topic.stage")}
            <select value={topic.stage ?? "shu"} onchange={(e) => update({ stage: e.currentTarget.value })}>
              {#each ["shu", "ha", "ri"] as s}<option value={s}>{t(`topic.stage_${s}`)}</option>{/each}
            </select>
          </label>
        {/if}
        <label class="field">
          {t("topic.exam_date")}
          <input type="date" value={topic.exam_date ?? ""} onchange={(e) => update({ exam_date: e.currentTarget.value || null })} />
          <span class="faint">{t("topic.exam_hint")}</span>
        </label>
        <div class="field">
          {t("topic.total")}
          <strong class="total">{duration(topic.focus_seconds)}</strong>
        </div>
      </div>

      <div class="card">
        <div class="row section-head">
          <h3 class="grow">{t("topic.notes")} ({notes.length})</h3>
          <button class="btn" onclick={openNotes}>{t("notes.title")} →</button>
        </div>
        {#each notes.slice(0, 5) as n}
          <button class="line" onclick={openNotes}>📝 {n.title || t("notes.untitled")}</button>
        {:else}
          <p class="faint">{t("notes.empty")}</p>
        {/each}
      </div>
    </div>

    <div class="card">
      <h3 class="section-head">{t("topic.sessions")}</h3>
      {#each sessions as s}
        <div class="row line">
          <span class="grow">{shortDateTime(s.started_at)}</span>
          {#if s.template_id}<span class="chip">{t(`templates.${s.template_id}.name`)}</span>{/if}
          <span>{duration(s.focus_seconds)}</span>
          <span class="stars">{s.rating ? "★".repeat(s.rating) : ""}</span>
        </div>
      {:else}
        <p class="faint">{t("topic.no_sessions")}</p>
      {/each}
    </div>
  </div>
{/if}

<style>
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .props { display: grid; gap: 14px; }
  .total { font-family: var(--font-display); font-size: 20px; color: var(--text); }
  .section-head { margin-bottom: 10px; }
  .line {
    display: flex; width: 100%; text-align: left; gap: 12px;
    padding: 8px 4px; border: 0; border-top: 1px solid var(--stroke); background: none;
  }
  button.line:hover { background: var(--subtle); }
  .stars { color: #c19c00; width: 70px; text-align: right; }
</style>
