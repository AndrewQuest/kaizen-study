<script lang="ts">
  import { ask } from "@tauri-apps/plugin-dialog";
  import { api, type Subject, type Topic } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { duration } from "$lib/format";
  import { t } from "$lib/i18n/i18n.svelte";
  import SubjectDialog from "$lib/components/SubjectDialog.svelte";
  import TopicDetail from "$lib/components/TopicDetail.svelte";

  let subjects = $state<Subject[]>([]);
  let topics = $state<Topic[]>([]);
  let showArchived = $state(false);
  let editing = $state<Partial<Subject> | null>(null);
  let topicId = $state<string | null>(null);
  let newTopic = $state("");

  const subject = $derived(subjects.find((s) => s.id === app.subjectId) ?? null);

  $effect(() => {
    void app.revision;
    void showArchived;
    loadSubjects();
  });

  $effect(() => {
    void app.revision;
    const id = app.subjectId;
    if (id) api.listTopics(id).then((r) => (topics = r)).catch(app.fail.bind(app));
    else topics = [];
  });

  async function loadSubjects() {
    try {
      subjects = await api.listSubjects(showArchived);
      if (!subjects.some((s) => s.id === app.subjectId)) app.subjectId = subjects[0]?.id ?? null;
    } catch (e) {
      app.fail(e);
    }
  }

  async function addTopic(e: SubmitEvent) {
    e.preventDefault();
    if (!newTopic.trim() || !subject) return;
    try {
      await api.saveTopic({ subject_id: subject.id, name: newTopic.trim() });
      newTopic = "";
      app.refresh();
    } catch (err) {
      app.fail(err);
    }
  }

  async function toggleArchive() {
    if (!subject) return;
    await api.saveSubject({ ...subject, archived: !subject.archived }).catch(app.fail.bind(app));
    app.refresh();
  }

  async function remove() {
    if (!subject) return;
    if (!(await ask(t("subjects.delete_confirm", { name: subject.name }), { kind: "warning" }))) return;
    try {
      await api.deleteSubject(subject.id);
    } catch (e) {
      return app.fail(e);
    }
    app.subjectId = null;
    app.refresh();
  }
</script>

<div class="layout">
  <aside>
    <div class="row head">
      <h2 class="grow">{t("subjects.title")}</h2>
      <button class="btn primary icon" title={t("subjects.new")} onclick={() => (editing = {})}>＋</button>
    </div>
    <div class="subjects">
      {#each subjects as s (s.id)}
        <button class="subject" class:on={s.id === app.subjectId} class:archived={s.archived}
          onclick={() => { app.subjectId = s.id; topicId = null; }}>
          <span class="icon" style:background="{s.color}22" style:color={s.color}>{s.icon}</span>
          <span class="grow">{s.name}</span>
        </button>
      {:else}
        <p class="faint pad">{t("subjects.empty")}</p>
      {/each}
    </div>
    <label class="row faint pad"><input type="checkbox" bind:checked={showArchived} /> {t("subjects.show_archived")}</label>
  </aside>

  <main>
    {#if topicId}
      <TopicDetail id={topicId} onback={() => (topicId = null)} />
    {:else if subject}
      <div class="page">
        <div class="page-head">
          <span class="big-icon" style:background="{subject.color}22">{subject.icon}</span>
          <h1 class="grow">{subject.name}</h1>
          <button class="btn" onclick={() => (editing = subject)}>{t("common.edit")}</button>
          <button class="btn" onclick={toggleArchive}>{subject.archived ? t("subjects.unarchive") : t("subjects.archive")}</button>
          <button class="btn danger" onclick={remove}>{t("common.delete")}</button>
        </div>

        <form class="row add" onsubmit={addTopic}>
          <input class="grow" type="text" placeholder={t("subjects.topic_name")} bind:value={newTopic} />
          <button class="btn primary" disabled={!newTopic.trim()}>＋ {t("subjects.new_topic")}</button>
        </form>

        <div class="topics">
          {#each topics as tp (tp.id)}
            <div class="card topic">
              <button class="open" onclick={() => (topicId = tp.id)}>
                <strong>{tp.name}</strong>
                <span class="row faint">
                  <span class="chip status-{tp.status}">{t(`topic.status_${tp.status}`)}</span>
                  {tp.session_count} {t("topic.sessions").toLowerCase()} · {duration(tp.focus_seconds)}
                </span>
              </button>
              <button class="btn primary" onclick={() => app.openStart(tp.id)}>▶ {t("topic.study")}</button>
            </div>
          {:else}
            <div class="card empty">{t("subjects.no_topics")}</div>
          {/each}
        </div>
      </div>
    {:else}
      <div class="empty">{subjects.length ? t("subjects.pick") : t("subjects.empty")}</div>
    {/if}
  </main>
</div>

{#if editing}
  <SubjectDialog subject={editing} onclose={() => (editing = null)}
    onsaved={(s) => { app.subjectId = s.id; editing = null; app.refresh(); }} />
{/if}

<style>
  .layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); height: 100%; }
  aside { border-right: 1px solid var(--stroke); display: flex; flex-direction: column; padding: 20px 8px 12px; min-height: 0; }
  .head { padding: 0 8px 12px; }
  .pad { padding: 8px; }
  .subjects { flex: 1; overflow: auto; display: grid; align-content: start; gap: 2px; }
  .subject {
    display: flex; align-items: center; gap: 10px; text-align: left;
    padding: 8px; border: 0; border-radius: var(--radius-sm); background: transparent;
  }
  .subject:hover { background: var(--subtle); }
  .subject.on { background: var(--subtle-2); font-weight: 600; }
  .subject.archived { opacity: 0.55; }
  .icon { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; font-size: 16px; }
  .big-icon { width: 44px; height: 44px; border-radius: 10px; display: grid; place-items: center; font-size: 24px; }
  main { min-height: 0; min-width: 0; overflow: hidden; }
  .add { margin-bottom: 16px; flex-wrap: wrap; }
  .add input { min-width: 180px; }
  .topics { display: grid; gap: 8px; }
  .topic { display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 16px; flex-wrap: wrap; }
  .open { flex: 1; display: grid; gap: 4px; text-align: left; background: none; border: 0; padding: 0; }
  .status-aprendiendo { color: var(--accent); }
  .status-repasando { color: var(--warning); }
  .status-dominado { color: var(--break); }
</style>
