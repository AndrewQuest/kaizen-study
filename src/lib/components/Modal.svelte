<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    title,
    onclose,
    width = 480,
    children,
    footer,
  }: { title: string; onclose: () => void; width?: number; children: Snippet; footer?: Snippet } = $props();
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onclose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={title} style:width="{width}px">
    <div class="body">
      <h2>{title}</h2>
      {@render children()}
    </div>
    {#if footer}
      <div class="footer">{@render footer()}</div>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0; z-index: 50;
    display: grid; place-items: center;
    background: rgba(0, 0, 0, 0.3);
    animation: fade 0.12s ease-out;
  }
  .dialog {
    max-width: calc(100vw - 48px); max-height: calc(100vh - 48px);
    display: flex; flex-direction: column;
    background: var(--layer-solid);
    border: 1px solid var(--stroke-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    animation: pop 0.16s cubic-bezier(0.1, 0.9, 0.2, 1);
  }
  .body { padding: 24px; display: grid; gap: 16px; overflow: auto; }
  .footer {
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 16px 24px; background: var(--subtle); border-top: 1px solid var(--stroke);
  }
  @keyframes fade { from { opacity: 0; } }
  @keyframes pop { from { transform: scale(1.04); opacity: 0; } }
</style>
