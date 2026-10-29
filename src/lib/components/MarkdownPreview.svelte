<script lang="ts">
  // Rendered preview for the split view (uses the shared render pipeline in $lib/render).
  import { renderDocument } from "$lib/render";

  let { source }: { source: string } = $props();
  let html = $state("");

  // Debounced re-render while typing.
  $effect(() => {
    const s = source;
    const h = setTimeout(async () => (html = await renderDocument(s)), 200);
    return () => clearTimeout(h);
  });

  // Links: a click opens them in the browser (global handler in app.svelte.ts).
</script>

<div class="md preview">{@html html}</div>

<style>
  .preview { overflow: auto; padding: 14px 20px 30vh; min-width: 0; }
</style>
