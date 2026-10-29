<script lang="ts">
  // Read-only rendering of Markdown with exactly the same look as the editor.
  import { onMount } from "svelte";
  import type { EditorView } from "@codemirror/view";
  import { createEditor } from "$lib/editor/setup";

  let { source }: { source: string } = $props();
  let host: HTMLDivElement;
  let view: EditorView | undefined;

  onMount(() => {
    view = createEditor({ parent: host, doc: source, readOnly: true });
    return () => view?.destroy();
  });

  $effect(() => {
    const s = source;
    if (view && s !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: s } });
    }
  });
</script>

<div class="view" bind:this={host}></div>

<style>
  .view :global(.cm-content) { padding: 6px 0 !important; }
  .view :global(.cm-line) { padding: 0 6px; }
</style>
