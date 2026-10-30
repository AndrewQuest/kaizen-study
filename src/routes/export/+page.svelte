<script lang="ts">
  // Export window: shows the document built by the exporter. `mode=pdf` (hidden window):
  // tells Rust when everything is loaded so WebView2 saves the PDF. `mode=print`: opens
  // the Windows print dialog and closes when done.
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { api } from "$lib/api";

  let html = $state("");

  onMount(async () => {
    document.documentElement.dataset.theme = "light";
    const mode = new URLSearchParams(location.search).get("mode");
    html = await api.exportDoc();
    await new Promise((r) => setTimeout(r, 50));
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) =>
        img.complete ? null : new Promise((r) => ((img.onload = r), (img.onerror = r))),
      ),
    );
    if (mode === "pdf") {
      await api.exportReady();
    } else {
      addEventListener("afterprint", () => getCurrentWindow().close());
      setTimeout(() => print(), 50);
    }
  });
</script>

<div class="export-page">{@html html}</div>

<style>
  :global(html), :global(body) { overflow: auto !important; height: auto !important; }
  .export-page { padding: 0; }
  @media screen {
    .export-page { padding: 24px 40px; }
  }
</style>
