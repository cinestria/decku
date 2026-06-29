<script lang="ts">
  import "../app.css";
  import { page } from "$app/stores";
  import Header from "$lib/Header.svelte";
  let { children } = $props();
</script>

{#if $page.url.pathname !== "/"}
  <Header />
{/if}

{@render children()}
