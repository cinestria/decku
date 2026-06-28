<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { loadPairing, clearPairing, type Pairing } from "$lib/pairing";
  import { DeckuClient } from "$lib/realtime-client";
  import type { SessionListItem, RenderEvent, TxPayload } from "@decku/shared";

  let pairing = $state<Pairing | null>(null);
  let status = $state("초기화…");
  let sessions = $state<SessionListItem[]>([]);
  let selected = $state<string | null>(null);
  let events = $state<RenderEvent[]>([]);
  let loading = $state(false);
  let draft = $state("");
  let sending = $state(false);
  let client: DeckuClient | null = null;

  function cwdName(cwd: string): string {
    return cwd.split("/").filter(Boolean).pop() ?? cwd;
  }

  onMount(async () => {
    const p = loadPairing();
    if (!p) {
      status = "페어링 필요";
      return;
    }
    pairing = p;
    client = new DeckuClient(p);
    try {
      await client.start((items) => {
        sessions = items;
      });
      status = `연결됨 · namespace ${p.ns.slice(0, 8)}…`;
    } catch (e) {
      status = "연결 실패: " + (e as Error).message;
    }
  });

  onDestroy(() => {
    void client?.stop();
  });

  async function open(sid: string) {
    if (!client || selected === sid) return;
    selected = sid;
    events = [];
    loading = true;
    await client.openSession(sid, (tx: TxPayload) => {
      events = [...events, ...tx.events];
      if (tx.done) loading = false;
    });
  }

  async function send(e: Event) {
    e.preventDefault();
    if (!client || !selected || !draft.trim() || sending) return;
    const text = draft;
    draft = "";
    sending = true;
    try {
      await client.sendChat(selected, text);
    } finally {
      sending = false;
    }
  }

  function unpair() {
    clearPairing();
    location.reload();
  }
</script>

<header>
  <strong>decku</strong>
  <span class="status">{status}</span>
  {#if pairing}<button onclick={unpair}>연결 해제</button>{/if}
</header>

{#if !pairing}
  <main class="empty">
    <h2>페어링이 필요합니다</h2>
    <p>Mac에서 <code>decku-bridge pair</code> 실행 후, 표시되는 QR을 스캔하거나 URL을 여세요.</p>
  </main>
{:else}
  <div class="layout">
    <aside>
      <h3>세션 {sessions.length}</h3>
      {#if sessions.length === 0}
        <p class="muted">대기 중…</p>
      {/if}
      {#each sessions as s (s.sessionId)}
        <button class="session" class:active={selected === s.sessionId} onclick={() => open(s.sessionId)}>
          <span class="cwd">{cwdName(s.cwd)}</span>
          <span class="path">{s.cwd}</span>
        </button>
      {/each}
    </aside>

    <section class="convo">
      {#if !selected}
        <p class="muted center">세션을 선택하세요.</p>
      {:else}
        <div class="scroll">
          {#if loading}<p class="muted">불러오는 중…</p>{/if}
          {#each events as ev, i (i)}
            {#if ev.kind === "title"}
              <div class="title">⭐ {ev.title}</div>
            {:else}
              <div class="msg {ev.role}">
                <span class="who">{ev.role}</span>
                <div class="blocks">
                  {#each ev.blocks as b}
                    {#if b.type === "text"}<p>{b.text}</p>
                    {:else if b.type === "thinking"}<p class="thinking">{b.text}</p>
                    {:else if b.type === "tool_use"}<p class="tool">⚙ {b.name}</p>
                    {:else if b.type === "tool_result"}<p class="tool">↳ {b.text.slice(0, 300)}</p>
                    {:else if b.type === "image"}<p class="tool">[image]</p>{/if}
                  {/each}
                </div>
              </div>
            {/if}
          {/each}
        </div>
        <form class="composer" onsubmit={send}>
          <input bind:value={draft} placeholder="메시지를 입력하면 이 세션에 전달됩니다…" disabled={sending} />
          <button type="submit" disabled={!draft.trim() || sending}>{sending ? "…" : "전송"}</button>
        </form>
      {/if}
    </section>
  </div>
{/if}

<style>
  :global(body) { margin: 0; }
  header {
    display: flex; align-items: center; gap: 1rem;
    padding: 0.6rem 1rem; border-bottom: 1px solid #e5e5e5;
    font-family: system-ui, sans-serif;
  }
  .status { color: #666; font-size: 0.85rem; }
  header button { margin-left: auto; font-size: 0.8rem; }
  .empty { max-width: 36rem; margin: 4rem auto; padding: 0 1rem; font-family: system-ui, sans-serif; }
  .layout { display: grid; grid-template-columns: 18rem 1fr; height: calc(100vh - 49px); font-family: system-ui, sans-serif; }
  aside { border-right: 1px solid #e5e5e5; overflow-y: auto; padding: 0.5rem; }
  aside h3 { font-size: 0.8rem; color: #888; text-transform: uppercase; margin: 0.5rem; }
  .session { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 0.5rem; border-radius: 6px; cursor: pointer; }
  .session:hover { background: #f3f3f3; }
  .session.active { background: #e8f0fe; }
  .session .cwd { display: block; font-weight: 600; font-size: 0.9rem; }
  .session .path { display: block; color: #999; font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .convo { display: flex; flex-direction: column; overflow: hidden; }
  .convo .scroll { flex: 1; overflow-y: auto; padding: 1rem 1.5rem; }
  .composer { display: flex; gap: 0.5rem; padding: 0.6rem 1rem; border-top: 1px solid #e5e5e5; }
  .composer input { flex: 1; padding: 0.5rem 0.7rem; border: 1px solid #ccc; border-radius: 6px; font-size: 0.9rem; }
  .composer button { padding: 0.5rem 1rem; border-radius: 6px; border: 1px solid #1a73e8; background: #1a73e8; color: #fff; cursor: pointer; }
  .composer button:disabled { opacity: 0.5; cursor: default; }
  .muted { color: #999; }
  .center { text-align: center; margin-top: 3rem; }
  .title { font-weight: 700; margin: 0.5rem 0 1rem; }
  .msg { margin: 0.75rem 0; }
  .msg .who { font-size: 0.7rem; text-transform: uppercase; color: #888; }
  .msg.user .who { color: #1a73e8; }
  .msg.assistant .who { color: #137333; }
  .blocks p { margin: 0.25rem 0; white-space: pre-wrap; word-break: break-word; }
  .thinking { color: #999; font-style: italic; }
  .tool { color: #b06000; font-family: ui-monospace, monospace; font-size: 0.85rem; }
  code { background: #f3f3f3; padding: 0.1rem 0.3rem; border-radius: 4px; }
</style>
