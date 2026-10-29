<script lang="ts">
  import { api, type Subject, type TimerConfig, type Topic } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { SUBJECT_COLORS } from "$lib/format";
  import { t, tList } from "$lib/i18n/i18n.svelte";
  import { TEMPLATES, noteSkeleton, templateById, timerFor } from "$lib/templates";
  import BreakPlanEditor from "./BreakPlanEditor.svelte";
  import Modal from "./Modal.svelte";

  let step = $state(1);
  let subjects = $state<Subject[]>([]);
  let topics = $state<Topic[]>([]);
  let subjectId = $state<string>("");
  let topicId = $state<string>("");
  let newSubject = $state<string | null>(null);
  let newTopic = $state<string | null>(null);
  let templateId = $state<string>(app.settings.last_template);
  let custom = $state({ focus: 25, brk: 5 });
  let busy = $state(false);
  let breakPlan = $state<string[]>([]);

  // Each method starts from its default break plan (last used or set in Settings).
  $effect(() => {
    breakPlan = app.breakPlan(templateId);
  });

  const topic = $derived(topics.find((x) => x.id === topicId));
  const tpl = $derived(templateById(templateId));
  const config = $derived<TimerConfig | null>(
    templateId === "free"
      ? { mode: "intervals", focus_min: Math.round(Number(custom.focus) || 0), break_min: Math.round(Number(custom.brk) || 0), long_break_min: 0, long_every: 0, flow_ratio: 5, spaced: false, break_plan: [] }
      : tpl && topic ? timerFor(tpl, topic) : null,
  );

  init();

  async function init() {
    try {
      subjects = await api.listSubjects();
      if (app.startTopicId) {
        const tp = await api.getTopic(app.startTopicId);
        subjectId = tp.subject_id;
        await loadTopics();
        topicId = tp.id;
        if (tp.template_id) templateId = tp.template_id;
        if (app.startTemplateId) templateId = app.startTemplateId;
        step = 2;
      } else if (subjects.length) {
        subjectId = subjects[0].id;
        await loadTopics();
      }
    } catch (e) {
      app.fail(e);
    }
  }

  async function loadTopics() {
    topics = subjectId ? await api.listTopics(subjectId) : [];
    topicId = topics[0]?.id ?? "";
  }

  async function createSubject() {
    if (!newSubject?.trim()) return;
    const s = await api.saveSubject({ name: newSubject.trim(), color: SUBJECT_COLORS[subjects.length % SUBJECT_COLORS.length] });
    subjects = [...subjects, s];
    subjectId = s.id;
    newSubject = null;
    await loadTopics();
    newTopic = "";
  }

  async function createTopic() {
    if (!newTopic?.trim() || !subjectId) return;
    const tp = await api.saveTopic({ subject_id: subjectId, name: newTopic.trim() });
    topics = [...topics, tp];
    topicId = tp.id;
    newTopic = null;
  }

  function pickTopic(id: string) {
    topicId = id;
    const tp = topics.find((x) => x.id === id);
    if (tp?.template_id) templateId = tp.template_id;
  }

  async function begin() {
    if (!topic || !config) return;
    busy = true;
    try {
      const tid = templateId === "free" ? null : templateId;
      // Remember the chosen method on the topic and as the global default.
      if (tid && tid !== topic.template_id) {
        await api.saveTopic({ ...topic, template_id: tid, stage: tid === "shuhari" ? (topic.stage ?? "shu") : topic.stage });
      }
      if (tpl && tpl.noteLayout !== "libre" && topic.session_count === 0) {
        const existing = await api.listNotes(topic.id);
        if (!existing.length) {
          await api.saveNote({ topic_id: topic.id, title: topic.name, layout: tpl.noteLayout, body_md: noteSkeleton(tpl.noteLayout, t) });
        }
      }
      await app.setSetting("last_template", templateId);
      await app.setBreakPlan(templateId, breakPlan);
      app.timer = await api.startSession(topic.id, tid, { ...config, break_plan: [...breakPlan] });
      app.startOpen = false;
      app.view = "session";
      app.refresh();
    } catch (e) {
      app.fail(e);
    } finally {
      busy = false;
    }
  }

  const close = () => (app.startOpen = false);
</script>

<Modal title={t("start.title")} onclose={close} width={720}>
  <div class="steps">
    {#each [1, 2, 3] as n}
      <span class:on={step === n} class:done={step > n}>{t(["", "start.step_topic", "start.step_method", "start.step_ready"][n])}</span>
    {/each}
  </div>

  {#if step === 1}
    <div class="cols">
      <div class="col">
        <h3>{t("start.subject")}</h3>
        {#each subjects as s (s.id)}
          <button class="pick" class:on={s.id === subjectId} onclick={() => { subjectId = s.id; loadTopics(); }}>
            <span class="dot" style:background={s.color}></span>{s.icon} {s.name}
          </button>
        {/each}
        {#if newSubject !== null}
          <form onsubmit={(e) => { e.preventDefault(); createSubject().catch(app.fail.bind(app)); }}>
            <!-- svelte-ignore a11y_autofocus -->
            <input type="text" bind:value={newSubject} placeholder={t("subjects.name")} autofocus />
          </form>
        {:else}
          <button class="btn ghost" onclick={() => (newSubject = "")}>{t("start.new_subject")}</button>
        {/if}
      </div>
      <div class="col">
        <h3>{t("start.topic")}</h3>
        {#each topics as tp (tp.id)}
          <button class="pick" class:on={tp.id === topicId} onclick={() => pickTopic(tp.id)}>
            {tp.name}
            {#if tp.template_id}<span class="faint">· {t(`templates.${tp.template_id}.name`)}</span>{/if}
          </button>
        {/each}
        {#if subjectId}
          {#if newTopic !== null}
            <form onsubmit={(e) => { e.preventDefault(); createTopic().catch(app.fail.bind(app)); }}>
              <!-- svelte-ignore a11y_autofocus -->
              <input type="text" bind:value={newTopic} placeholder={t("subjects.topic_name")} autofocus />
            </form>
          {:else}
            <button class="btn ghost" onclick={() => (newTopic = "")}>{t("start.new_topic")}</button>
          {/if}
        {/if}
      </div>
    </div>
  {:else if step === 2}
    <div class="templates">
      {#each TEMPLATES as tp (tp.id)}
        <button class="tpl" class:on={tp.id === templateId} onclick={() => (templateId = tp.id)}>
          <span class="method-icon">{tp.icon}</span>
          <strong>{t(`templates.${tp.id}.name`)}</strong>
          <span class="faint">
            {tp.timer.mode === "flow"
              ? t("start.flow_desc")
              : `${t("start.focus_for", { n: topic ? timerFor(tp, topic).focus_min : tp.timer.focus_min })}, ${t("start.break_for", { n: tp.timer.break_min })}`}
          </span>
        </button>
      {/each}
      <button class="tpl" class:on={templateId === "free"} onclick={() => (templateId = "free")}>
        <span class="method-icon">⏱️</span>
        <strong>{t("start.free")}</strong>
        <span class="faint">{t("start.focus_for", { n: custom.focus })}, {t("start.break_for", { n: custom.brk })}</span>
      </button>
    </div>
  {:else}
    {#if templateId === "free"}
      <div class="row">
        <label class="field">{t("start.focus_min")}<input type="number" min="1" max="600" bind:value={custom.focus} /></label>
        <label class="field">{t("start.break_min")}<input type="number" min="0" max="600" bind:value={custom.brk} /></label>
      </div>
    {:else if tpl}
      <div class="explain">
        <div class="row">
          <span class="method-icon big">{tpl.icon}</span>
          <div>
            <h2>{t(`templates.${tpl.id}.name`)}</h2>
            <span class="faint">{t(`templates.${tpl.id}.origin`)}</span>
          </div>
        </div>
        <p>{t(`templates.${tpl.id}.summary`)}</p>
        <h3>{t("start.how")}</h3>
        <ol>
          {#each tList(`templates.${tpl.id}.steps`) as s}<li>{s}</li>{/each}
        </ol>
        {#if config && config.mode !== "flow"}
          <div class="chip">⏱ {t("start.focus_for", { n: config.focus_min })}, {t("start.break_for", { n: config.break_min })}</div>
        {/if}
        <p class="faint"><strong>{t("session.break_guide")}:</strong> {t(`templates.${tpl.id}.break_guide`)}</p>
      </div>
    {/if}
    <div class="breaks">
      <h3>{t("breaks.title")}</h3>
      <p class="faint">{t("breaks.hint")}</p>
      <BreakPlanEditor bind:plan={breakPlan} allowCustom />
    </div>
  {/if}

  {#snippet footer()}
    {#if step > 1}<button class="btn" onclick={() => step--}>{t("common.back")}</button>{/if}
    <span class="grow"></span>
    {#if step < 3}
      <button class="btn primary" disabled={!topicId} onclick={() => step++}>{t("start.next")}</button>
    {:else}
      <button class="btn primary" disabled={busy || !config || (templateId === "free" && !(config.focus_min >= 1 && config.focus_min <= 600))} onclick={begin}>
        ▶ {t("start.begin")}
      </button>
    {/if}
  {/snippet}
</Modal>

<style>
  .steps { display: flex; gap: 8px; }
  .steps span { flex: 1; padding-bottom: 6px; border-bottom: 3px solid var(--subtle-2); color: var(--text-3); font-size: 13px; }
  .steps .on { border-color: var(--accent); color: var(--text); font-weight: 600; }
  .steps .done { border-color: var(--accent); opacity: 0.5; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; min-height: 260px; }
  .col { display: grid; align-content: start; gap: 4px; max-height: 340px; overflow: auto; }
  .col h3 { margin-bottom: 6px; }
  .pick {
    display: flex; align-items: center; gap: 8px; text-align: left;
    padding: 8px 10px; border-radius: var(--radius-sm); border: 1px solid transparent; background: none;
  }
  .pick:hover { background: var(--subtle); }
  .pick.on { background: var(--accent-soft); border-color: var(--accent); }
  .templates { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; max-height: 420px; overflow: auto; }
  .tpl {
    display: grid; gap: 4px; text-align: left; padding: 12px;
    border: 1px solid var(--stroke-strong); border-radius: var(--radius); background: var(--card);
  }
  .tpl:hover { background: var(--card-hover); }
  .tpl.on { border-color: var(--accent); background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent); }
  .method-icon { font-size: 22px; }
  .method-icon.big { font-size: 36px; }
  .explain { display: grid; gap: 12px; }
  .breaks { display: grid; gap: 6px; padding-top: 12px; border-top: 1px solid var(--stroke); }
  .explain ol { margin: 0; padding-left: 20px; display: grid; gap: 4px; }
  .explain .chip { justify-self: start; }
</style>
