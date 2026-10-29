<script lang="ts">
  import { api, type Note, type Session } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { longDate } from "$lib/format";
  import { t } from "$lib/i18n/i18n.svelte";
  import Modal from "./Modal.svelte";

  let {
    session,
    notes,
    onclose,
    ondone,
  }: { session: Session; notes: Note[]; onclose: () => void; ondone: (note: Note) => void } = $props();

  // svelte-ignore state_referenced_locally
  const date = longDate(session.started_at);
  let mode = $state<"new" | "append">("new");
  let title = $state(t("notes.move_new_title", { date }));
  // svelte-ignore state_referenced_locally
  let target = $state(notes[0]?.id ?? "");
  let busy = $state(false);

  async function run() {
    busy = true;
    try {
      const note = await api.moveQuickNote(
        session.id,
        mode === "append" ? target : null,
        title.trim() || t("notes.untitled"),
        t("notes.move_heading", { date }),
      );
      ondone(note);
    } catch (e) {
      app.fail(e);
    } finally {
      busy = false;
    }
  }
</script>

<Modal title={t("notes.move_title")} {onclose}>
  <label class="row"><input type="radio" bind:group={mode} value="new" /> {t("notes.move_new")}</label>
  {#if mode === "new"}
    <input type="text" bind:value={title} aria-label={t("notes.title_ph")} />
  {/if}
  <label class="row"><input type="radio" bind:group={mode} value="append" disabled={!notes.length} /> {t("notes.move_append")}</label>
  {#if mode === "append"}
    <select bind:value={target} aria-label={t("notes.title")}>
      {#each notes as n (n.id)}<option value={n.id}>{n.title || t("notes.untitled")}</option>{/each}
    </select>
  {/if}
  {#snippet footer()}
    <button class="btn" onclick={onclose}>{t("common.cancel")}</button>
    <button class="btn primary" disabled={busy || (mode === "append" && !target)} onclick={run}>{t("notes.move")}</button>
  {/snippet}
</Modal>
