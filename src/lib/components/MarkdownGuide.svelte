<script lang="ts">
  // Beginner-friendly Markdown guide organised by "what do you want to do?".
  import { t, tList, tRaw } from "$lib/i18n/i18n.svelte";
  import MarkdownView from "./MarkdownView.svelte";
  import Modal from "./Modal.svelte";

  interface GuideItem {
    id: string;
    icon: string;
    title: string;
    when: string;
    how: string;
    example: string;
    tip: string;
  }

  let { onclose, oninsert }: { onclose: () => void; oninsert?: (text: string) => void } = $props();

  const items = tRaw<GuideItem[]>("guide.items") ?? [];
  const shortcuts = tRaw<[string, string][]>("guide.shortcut_list") ?? [];
  let selected = $state<string>("intro");
  let copied = $state(false);

  const item = $derived(items.find((i) => i.id === selected));

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<Modal title={t("guide.title")} {onclose} width={940}>
  <div class="guide">
    <nav aria-label={t("guide.subtitle")}>
      <span class="faint">{t("guide.subtitle")}</span>
      <button class:on={selected === "intro"} onclick={() => (selected = "intro")}>
        <span class="icon">?</span>{t("guide.intro_title")}
      </button>
      {#each items as i (i.id)}
        <button class:on={selected === i.id} onclick={() => (selected = i.id)}>
          <span class="icon">{i.icon}</span>{i.title}
        </button>
      {/each}
      <button class:on={selected === "shortcuts"} onclick={() => (selected = "shortcuts")}>
        <span class="icon">⌨</span>{t("guide.shortcuts")}
      </button>
    </nav>

    <section>
      {#if selected === "intro"}
        <h2>{t("guide.intro_title")}</h2>
        <p>{t("guide.intro_body")}</p>
        <ol>{#each tList("guide.intro_steps") as s}<li>{s}</li>{/each}</ol>
      {:else if selected === "shortcuts"}
        <h2>{t("guide.shortcuts")}</h2>
        <table>
          <tbody>
            {#each shortcuts as [keys, what]}
              <tr><td><kbd>{keys}</kbd></td><td>{what}</td></tr>
            {/each}
          </tbody>
        </table>
      {:else if item}
        <h2>{item.title}</h2>
        <div class="block">
          <h3>{t("guide.when")}</h3>
          <p class="muted">{item.when}</p>
        </div>
        <div class="block">
          <h3>{t("guide.how")}</h3>
          <p>{item.how}</p>
        </div>
        {#if item.example}
          <div class="example">
            <div>
              <h3>{t("guide.write")}</h3>
              <pre>{item.example}</pre>
            </div>
            <div>
              <h3>{t("guide.result")}</h3>
              <div class="result">
                {#key item.id}<MarkdownView source={item.example} />{/key}
              </div>
            </div>
          </div>
        {/if}
        {#if item.tip}<p class="tip">💡 <strong>{t("guide.tip")}:</strong> {item.tip}</p>{/if}
        {#if item.example}
          <div class="row actions">
            {#if oninsert}
              <button class="btn primary" onclick={() => oninsert(item!.example)}>＋ {t("guide.insert")}</button>
            {/if}
            <button class="btn" onclick={() => copy(item!.example)}>{copied ? `✓ ${t("guide.copied")}` : t("guide.copy")}</button>
          </div>
        {/if}
      {/if}
    </section>
  </div>
</Modal>

<style>
  .guide { display: grid; grid-template-columns: 250px 1fr; gap: 20px; height: min(580px, 70vh); }
  nav { display: flex; flex-direction: column; gap: 2px; overflow: auto; border-right: 1px solid var(--stroke); padding-right: 12px; }
  nav .faint { padding: 0 8px 6px; }
  nav button {
    display: flex; align-items: center; gap: 10px; text-align: left;
    padding: 7px 8px; border: 0; border-radius: var(--radius-sm); background: none;
  }
  nav button:hover { background: var(--subtle); }
  nav button.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .icon {
    flex: none; width: 26px; height: 26px; display: grid; place-items: center; border-radius: 6px;
    background: var(--subtle-2); font-size: 12px; font-weight: 700; font-family: var(--mono);
  }
  section { overflow: auto; display: flex; flex-direction: column; gap: 14px; padding-right: 4px; }
  .block { display: grid; gap: 4px; }
  .example { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; align-items: start; }
  .example h3 { margin-bottom: 6px; }
  pre {
    margin: 0; padding: 10px 12px; white-space: pre-wrap;
    font-family: var(--mono); font-size: 13px; line-height: 1.6;
    background: var(--subtle); border: 1px solid var(--stroke); border-radius: var(--radius-sm);
  }
  .result { border: 1px solid var(--stroke); border-radius: var(--radius-sm); background: var(--card); }
  .tip { padding: 10px 12px; border-radius: var(--radius-sm); background: var(--accent-soft); }
  ol { margin: 0; padding-left: 20px; display: grid; gap: 4px; }
  table { border-collapse: collapse; }
  td { padding: 8px 12px; border-bottom: 1px solid var(--stroke); }
  kbd {
    font-family: var(--mono); font-size: 12px; padding: 2px 8px; white-space: nowrap;
    border: 1px solid var(--stroke-strong); border-bottom-width: 2px; border-radius: 4px; background: var(--subtle);
  }
  /* Keep the actions visible even when the example is long. */
  .actions { margin-top: auto; position: sticky; bottom: 0; padding: 10px 0 2px; background: var(--layer-solid); }
</style>
