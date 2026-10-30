<script lang="ts">
  import { ask } from "@tauri-apps/plugin-dialog";
  import { api, type Note, type NoteHit, type NoteLayout, type QuickNoteHit, type Session, type Subject, type Topic } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { duration, shortDateTime } from "$lib/format";
  import { t } from "$lib/i18n/i18n.svelte";
  import { noteSkeleton } from "$lib/templates";
  import MarkdownEditor from "$lib/components/MarkdownEditor.svelte";
  import MarkdownView from "$lib/components/MarkdownView.svelte";
  import LatexNoteEditor from "$lib/components/LatexNoteEditor.svelte";
  import MoveQuickNoteDialog from "$lib/components/MoveQuickNoteDialog.svelte";
  import ExportDialog from "$lib/components/ExportDialog.svelte";

  let subjects = $state<Subject[]>([]);
  let exporting = $state(false);
  let topicsBySubject = $state<Record<string, Topic[]>>({});
  let notes = $state<Note[]>([]);
  let quick = $state<Session[]>([]);
  let current = $state<Note | null>(null);
  /** Quick note (session notes) being viewed; mutually exclusive with `current`. */
  let currentQuick = $state<Session | null>(null);
  let moving = $state(false);
  let selecting = $state(false);
  let selectedQuick = $state<string[]>([]);
  let query = $state("");
  let hits = $state<NoteHit[]>([]);
  let quickHits = $state<QuickNoteHit[]>([]);
  let dirty = false;
  /** The note created in this visit opens in edit mode; every other note opens locked (reading). */
  let createdId = $state<string | null>(null);
  /** Note / quick note to select once the topic is loaded (from a search result). */
  let pendingNoteId: string | null = null;
  let pendingQuickId: string | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const notebook = $derived(app.settings.notebook);
  /** Width of the Notes area; below NARROW the side columns become drawers over the note. */
  let width = $state(1200);
  const NARROW = 860;
  const narrow = $derived(width < NARROW);
  let drawer = $state<"tree" | "list" | null>(null);
  const hideTree = $derived(notebook || (narrow ? drawer !== "tree" : app.settings.notes_hide_tree));
  const hideList = $derived(notebook || (narrow ? drawer !== "list" : app.settings.notes_hide_list));
  const columns = $derived(
    narrow ? "minmax(0, 1fr)" : [hideTree ? "" : "220px", hideList ? "" : "240px", "minmax(0, 1fr)"].filter(Boolean).join(" "),
  );

  const LAYOUTS: NoteLayout[] = ["libre", "cornell", "feynman", "preguntas", "latex", "latexdoc"];

  $effect(() => {
    loadTree();
    return () => void flush();
  });

  $effect(() => {
    const id = app.notesTopicId;
    current = null;
    currentQuick = null;
    if (id) loadTopic(id);
    else {
      notes = [];
      quick = [];
    }
  });

  $effect(() => {
    const q = query.trim();
    if (!q) {
      hits = [];
      quickHits = [];
      return;
    }
    const h = setTimeout(async () => {
      [hits, quickHits] = await Promise.all([api.searchNotes(q), api.searchQuickNotes(q)]);
    }, 200);
    return () => clearTimeout(h);
  });

  async function loadTopic(id: string) {
    try {
      const [n, q] = await Promise.all([api.listNotes(id), api.listQuickNotes(id)]);
      notes = n;
      quick = q;
      // Pick from the reactive arrays so edits also update the lists.
      currentQuick = quick.find((x) => x.id === pendingQuickId) ?? null;
      current = currentQuick ? null : (notes.find((x) => x.id === pendingNoteId) ?? notes[0] ?? null);
      if (!current && !currentQuick) currentQuick = quick[0] ?? null;
      pendingNoteId = pendingQuickId = null;
    } catch (e) {
      app.fail(e);
    }
  }

  async function loadTree() {
    subjects = await api.listSubjects();
    const entries = await Promise.all(subjects.map(async (s) => [s.id, await api.listTopics(s.id)] as const));
    topicsBySubject = Object.fromEntries(entries);
    if (!app.notesTopicId) app.notesTopicId = entries.find(([, ts]) => ts.length)?.[1][0].id ?? null;
  }

  async function flush() {
    clearTimeout(saveTimer);
    if (!dirty || !current) return;
    dirty = false;
    const saved = await api.saveNote(current);
    const inList = notes.find((n) => n.id === saved.id);
    if (inList) inList.updated_at = saved.updated_at;
  }

  function changed() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 700);
  }

  async function select(n: Note) {
    drawer = null;
    await flush();
    currentQuick = null;
    current = n;
  }

  async function selectQuick(s: Session) {
    drawer = null;
    await flush();
    current = null;
    currentQuick = s;
  }

  async function openHit(h: NoteHit) {
    drawer = null;
    await flush();
    query = "";
    if (app.notesTopicId === h.topic_id) {
      currentQuick = null;
      current = notes.find((n) => n.id === h.id) ?? current;
    } else {
      pendingNoteId = h.id;
      app.notesTopicId = h.topic_id;
    }
  }

  async function openQuickHit(h: QuickNoteHit) {
    drawer = null;
    await flush();
    query = "";
    if (app.notesTopicId === h.topic_id) {
      current = null;
      currentQuick = quick.find((q) => q.id === h.id) ?? null;
    } else {
      pendingQuickId = h.id;
      app.notesTopicId = h.topic_id;
    }
  }

  async function create() {
    if (!app.notesTopicId) return;
    drawer = null;
    await flush();
    const n = await api.saveNote({ topic_id: app.notesTopicId, title: t("notes.untitled") });
    createdId = n.id;
    notes = [n, ...notes];
    currentQuick = null;
    current = notes[0];
  }

  async function setLayout(layout: NoteLayout) {
    if (!current) return;
    current.layout = layout;
    if (!current.body_md.trim()) current.body_md = noteSkeleton(layout, t);
    changed();
  }

  async function remove() {
    if (!current) return;
    if (!(await ask(t("notes.delete_confirm", { name: current.title || t("notes.untitled") }), { kind: "warning" }))) return;
    // A pending autosave would re-create the deleted note (saving is an upsert).
    clearTimeout(saveTimer);
    dirty = false;
    const id = current.id;
    try {
      await api.deleteNote(id);
    } catch (e) {
      return app.fail(e);
    }
    notes = notes.filter((n) => n.id !== id);
    current = notes[0] ?? null;
  }

  async function deleteQuick(ids: string[]) {
    const msg = ids.length === 1 ? t("notes.quick_delete_confirm") : t("notes.quick_delete_many_confirm", { n: ids.length });
    if (!ids.length || !(await ask(msg, { kind: "warning" }))) return;
    try {
      await api.clearQuickNotes(ids);
      quick = quick.filter((q) => !ids.includes(q.id));
      if (currentQuick && ids.includes(currentQuick.id)) currentQuick = null;
      selectedQuick = [];
      selecting = false;
    } catch (e) {
      app.fail(e);
    }
  }

  async function moved(note: Note) {
    moving = false;
    const topic = app.notesTopicId!;
    pendingNoteId = note.id;
    await loadTopic(topic);
    app.notify(t("notes.move_done"));
  }

  const quickTitle = (s: Session) => t("notes.quick_title", { date: shortDateTime(s.started_at) });
  const quickMeta = (s: Session) =>
    t("notes.quick_meta", {
      method: s.template_id ? t(`templates.${s.template_id}.name`) : t("notes.free_timer"),
      duration: duration(s.focus_seconds),
    });
</script>

<svelte:window onkeydown={(e) => {
  // Esc leaves notebook mode, unless a dialog or the spelling menu is open (Esc closes those).
  if (e.key === "Escape" && notebook && !document.querySelector(".backdrop, .spell-menu")) app.setSetting("notebook", false);
}} />

<div class="layout" style:grid-template-columns={columns} bind:clientWidth={width}>
  {#if !hideTree}
  <aside class="tree" class:drawer={narrow}>
    <input type="search" placeholder={t("notes.search_ph")} bind:value={query} />
    {#if query.trim()}
      <p class="faint">{t("notes.results", { n: hits.length + quickHits.length })}</p>
      {#each hits as h (h.id)}
        <button class="hit" onclick={() => openHit(h)}>
          <strong>{h.title || t("notes.untitled")}</strong>
          <span class="faint"><span class="dot inline" style:background={h.subject_color}></span>{h.subject_name} › {h.topic_name}</span>
        </button>
      {/each}
      {#each quickHits as h (h.id)}
        <button class="hit" onclick={() => openQuickHit(h)}>
          <strong>⚡ {quickTitle(h)}</strong>
          <span class="faint"><span class="dot inline" style:background={h.subject_color}></span>{h.subject_name} › {h.topic_name}</span>
        </button>
      {/each}
    {:else}
      {#each subjects as s (s.id)}
        <div class="group">
          <span class="faint group-title">{s.icon} {s.name}</span>
          {#each topicsBySubject[s.id] ?? [] as tp (tp.id)}
            <button class="topic" class:on={tp.id === app.notesTopicId} onclick={() => flush().then(() => { app.notesTopicId = tp.id; if (narrow) drawer = "list"; })}>
              {tp.name}
            </button>
          {/each}
        </div>
      {/each}
    {/if}
  </aside>
  {/if}

  {#if !hideList}
  <aside class="list" class:drawer={narrow}>
    <button class="btn primary" disabled={!app.notesTopicId} onclick={create}>＋ {t("notes.new")}</button>
    {#each notes as n (n.id)}
      <button class="note" class:on={n.id === current?.id} onclick={() => select(n)}>
        <strong>{n.title || t("notes.untitled")}</strong>
        <span class="faint">{shortDateTime(n.updated_at)}</span>
      </button>
    {:else}
      <p class="faint">{app.notesTopicId ? t("notes.empty") : t("notes.pick_topic")}</p>
    {/each}

    {#if app.notesTopicId}
      <div class="row section">
        <h3 class="grow">⚡ {t("notes.quick")}</h3>
        {#if quick.length}
          <button class="btn ghost small" onclick={() => { selecting = !selecting; selectedQuick = []; }}>
            {selecting ? t("notes.quick_select_done") : t("notes.quick_select")}
          </button>
        {/if}
      </div>
      {#if selecting}
        <button class="btn danger small" disabled={!selectedQuick.length} onclick={() => deleteQuick(selectedQuick)}>
          🗑 {t("notes.quick_delete_selected", { n: selectedQuick.length })}
        </button>
      {/if}
      {#each quick as q (q.id)}
        <div class="quick-row">
          {#if selecting}
            <input type="checkbox" aria-label={quickTitle(q)} bind:group={selectedQuick} value={q.id} />
          {/if}
          <button class="note quick-item grow" class:on={q.id === currentQuick?.id} onclick={() => selectQuick(q)}>
            <strong>{shortDateTime(q.started_at)}</strong>
            <span class="faint">{quickMeta(q)}</span>
            {#if q.notes_moved}<span class="chip moved">✓ {t("notes.moved")}</span>{/if}
          </button>
          {#if !selecting}
            <button class="btn ghost icon trash" title={t("notes.quick_delete")} aria-label={t("notes.quick_delete")}
              onclick={() => deleteQuick([q.id])}>🗑</button>
          {/if}
        </div>
      {:else}
        <p class="faint">{t("notes.quick_empty")}</p>
      {/each}
    {/if}
  </aside>
  {/if}

  <main>
    <div class="row panes-bar">
      {#if notebook}
        <button class="btn" onclick={() => app.setSetting("notebook", false)}>✕ {t("notes.notebook_exit")}</button>
      {:else if narrow}
        <!-- Not enough room for the side columns: they open as drawers over the note. -->
        <button class="btn ghost" class:on={drawer === "tree"} aria-pressed={drawer === "tree"}
          onclick={() => (drawer = drawer === "tree" ? null : "tree")}>📂 {t("notes.topics_btn")}</button>
        <button class="btn ghost" class:on={drawer === "list"} aria-pressed={drawer === "list"}
          onclick={() => (drawer = drawer === "list" ? null : "list")}>🗒️ {t("notes.list_btn")}</button>
        <span class="grow"></span>
        <button class="btn" onclick={() => app.setSetting("notebook", true)}>📖 {t("notes.notebook")}</button>
      {:else}
        <button class="btn ghost" class:on={!app.settings.notes_hide_tree} aria-pressed={!app.settings.notes_hide_tree}
          onclick={() => app.setSetting("notes_hide_tree", !app.settings.notes_hide_tree)}>
          📂 {app.settings.notes_hide_tree ? t("notes.show_tree") : t("notes.hide_tree")}
        </button>
        <button class="btn ghost" class:on={!app.settings.notes_hide_list} aria-pressed={!app.settings.notes_hide_list}
          onclick={() => app.setSetting("notes_hide_list", !app.settings.notes_hide_list)}>
          🗒️ {app.settings.notes_hide_list ? t("notes.show_list") : t("notes.hide_list")}
        </button>
        <span class="grow"></span>
        <button class="btn" onclick={() => app.setSetting("notebook", true)}>📖 {t("notes.notebook")}</button>
      {/if}
    </div>
    {#if current}
      <div class="row head">
        <input class="grow title" type="text" placeholder={t("notes.title_ph")} bind:value={current.title} oninput={changed} />
        <select value={current.layout} onchange={(e) => setLayout(e.currentTarget.value as NoteLayout)} title={t("notes.layout")}>
          {#each LAYOUTS as l}<option value={l}>{t(`notes.layout_${l}`)}</option>{/each}
        </select>
        <button class="btn" onclick={async () => (await flush(), (exporting = true))}>{t("export.button")}</button>
        <button class="btn danger" onclick={remove}>{t("common.delete")}</button>
      </div>
      {#key current.id + current.layout}
        {#if current.layout === "latex" || current.layout === "latexdoc"}
          <LatexNoteEditor bind:value={current.body_md} noteId={current.id} title={current.title}
            layout={current.layout} oninput={changed} />
        {:else}
          <MarkdownEditor bind:value={current.body_md} oninput={changed} locked={current.id !== createdId} />
        {/if}
      {/key}
    {:else if currentQuick}
      <div class="row head">
        <div class="grow">
          <h2>⚡ {quickTitle(currentQuick)}</h2>
          <span class="faint">{quickMeta(currentQuick)}</span>
        </div>
        {#if currentQuick.notes_moved}<span class="chip moved">✓ {t("notes.moved")}</span>{/if}
        <button class="btn danger" onclick={() => deleteQuick([currentQuick!.id])}>🗑 {t("common.delete")}</button>
        <button class="btn primary" onclick={() => (moving = true)}>{t("notes.move")}</button>
      </div>
      <div class="quick-view">
        {#key currentQuick.id}<MarkdownView source={currentQuick.notes_md} />{/key}
      </div>
    {:else}
      <div class="empty">{app.notesTopicId ? t("notes.empty") : t("notes.pick_topic")}</div>
    {/if}
  </main>
</div>

{#if moving && currentQuick}
  <MoveQuickNoteDialog session={currentQuick} {notes} onclose={() => (moving = false)} ondone={moved} />
{/if}

{#if exporting && current}
  <ExportDialog scope="note" note={current} topicId={current.topic_id}
    subjectId={Object.entries(topicsBySubject).find(([, ts]) => ts.some((x) => x.id === current!.topic_id))?.[0]}
    onclose={() => (exporting = false)} />
{/if}

<style>
  .layout { display: grid; height: 100%; position: relative; }
  aside.drawer {
    position: absolute; top: 0; bottom: 0; left: 0; z-index: 30; width: min(300px, 85%);
    background: var(--layer-solid); box-shadow: var(--shadow-lg);
  }
  .panes-bar { gap: 4px; margin: -6px 0 -4px; }
  .panes-bar .btn { min-height: 30px; font-size: 13px; }
  .panes-bar .btn.ghost:not(.on) { color: var(--accent); }
  aside { display: flex; flex-direction: column; gap: 4px; padding: 16px 8px; overflow: auto; border-right: 1px solid var(--stroke); }
  .group { display: grid; gap: 2px; margin-top: 10px; }
  .group-title { padding: 0 8px 2px; }
  .topic, .note, .hit {
    display: grid; gap: 2px; text-align: left; padding: 7px 10px;
    border: 0; border-radius: var(--radius-sm); background: none;
  }
  .topic:hover, .note:hover, .hit:hover { background: var(--subtle); }
  .topic.on, .note.on { background: var(--subtle-2); font-weight: 600; }
  .list .btn { margin-bottom: 8px; }
  .section { margin: 18px 4px 4px 10px; color: var(--text-2); }
  .section h3 { font-size: 13px; }
  .small { min-height: 30px; padding: 2px 10px; font-size: 13px; }
  .quick-row { display: flex; align-items: center; gap: 4px; }
  .quick-row input { margin-left: 6px; }
  .trash { opacity: 0.6; font-size: 18px; }
  .trash:hover, .trash:focus-visible { opacity: 1; }
  .moved { justify-self: start; color: var(--break); font-size: 11px; padding: 0 8px; }
  .dot.inline { display: inline-block; width: 8px; height: 8px; margin-right: 4px; }
  main { display: flex; flex-direction: column; gap: 12px; padding: 16px 20px; min-height: 0; min-width: 0; }
  .title { font-size: 18px; font-weight: 600; }
  .quick-view { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--stroke); border-radius: var(--radius); background: var(--card); }
</style>
