<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import QRCode from "qrcode";
  import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
  import { loadPairing, clearPairing, savePairingFromUrl, type Pairing } from "$lib/pairing";
  import { DeckuClient } from "$lib/realtime-client";
  import { fileToAttachment } from "$lib/image";
  import type { SessionListItem, RenderEvent, TxPayload, ImageAttachment } from "@decku/shared";

  let pairing = $state<Pairing | null>(null);
  let status = $state("초기화…");
  let connected = $state(false);
  let online = $state(false); // 브릿지 heartbeat 수신 중인가
  let lastSeen = 0; // 마지막 세션목록 수신 시각 (비반응)
  let sessions = $state<SessionListItem[]>([]);
  let view = $state<"live" | "history">("live");
  let history = $state<SessionListItem[]>([]);
  let historyLoading = $state(false);
  let selected = $state<string | null>(null);
  let events = $state<RenderEvent[]>([]);
  let loading = $state(false);
  let draft = $state("");
  let pendingImages = $state<{ att: ImageAttachment; url: string }[]>([]);
  let sending = $state(false);
  let client: DeckuClient | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let qrUrl = $state<string | null>(null); // QR 오버레이 (폰에서 열기)

  // 카메라 스캐너 (페어링)
  let scanning = $state(false);
  let scanError = $state("");
  let videoEl = $state<HTMLVideoElement | undefined>();
  let scanControls: IScannerControls | null = null;

  // PWA 설치
  let installPrompt = $state<{ prompt: () => void } | null>(null);
  let isIos = $state(false);
  let standalone = $state(false);
  let showIosHint = $state(false);

  function cwdName(cwd: string): string {
    return cwd.split("/").filter(Boolean).pop() ?? cwd;
  }

  async function startScan() {
    scanError = "";
    scanning = true;
    await tick(); // <video> 렌더 대기
    try {
      const reader = new BrowserQRCodeReader();
      scanControls = await reader.decodeFromVideoDevice(undefined, videoEl, (result) => {
        if (result && savePairingFromUrl(result.getText())) {
          stopScan();
          location.reload(); // 저장된 페어링으로 재초기화
        }
        // 프레임마다 나는 NotFound 에러는 정상 → 무시
      });
    } catch (e) {
      scanError = "카메라를 열 수 없어요: " + (e as Error).message;
      scanning = false;
    }
  }

  function stopScan() {
    scanControls?.stop();
    scanControls = null;
    scanning = false;
  }

  function installApp() {
    if (installPrompt) {
      installPrompt.prompt();
      installPrompt = null;
    } else if (isIos) {
      showIosHint = true;
    }
  }

  /** 현재 페어링을 QR로 — 폰 카메라로 찍으면 폰에서 decku가 열림. */
  async function showPhoneQr() {
    if (!pairing) return;
    const link = `${location.origin}/#ns=${pairing.ns}&pt=${encodeURIComponent(pairing.pt)}&k=${pairing.k}`;
    qrUrl = await QRCode.toDataURL(link, { width: 280, margin: 2 });
  }

  onMount(async () => {
    // PWA 설치 가능 감지
    isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as { standalone?: boolean }).standalone === true;
    window.addEventListener("beforeinstallprompt", (e: Event) => {
      e.preventDefault();
      installPrompt = e as unknown as { prompt: () => void };
    });

    const p = loadPairing();
    if (!p) {
      status = "페어링 필요";
      return;
    }
    pairing = p;
    client = new DeckuClient(p);
    try {
      await client.start({
        onSessions: (items) => {
          sessions = items;
          lastSeen = Date.now();
        },
        onHistory: (items) => {
          history = items;
          historyLoading = false;
        },
      });
      connected = true;
      status = `namespace ${p.ns.slice(0, 8)}…`;
    } catch (e) {
      status = "연결 실패: " + (e as Error).message;
    }
    // heartbeat 기반 온라인 판정 (브릿지가 ~4s마다 목록 재전송)
    heartbeatTimer = setInterval(() => {
      online = lastSeen > 0 && Date.now() - lastSeen < 12000;
    }, 2000);
  });

  onDestroy(() => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    stopScan();
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

  function openHistory() {
    if (!client) return;
    view = "history";
    if (history.length === 0) {
      historyLoading = true;
      void client.requestHistory(40);
    }
  }

  async function addImages(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";
    for (const f of files) {
      try {
        const att = await fileToAttachment(f);
        pendingImages = [...pendingImages, { att, url: `data:${att.mediaType};base64,${att.dataBase64}` }];
      } catch (err) {
        console.error("이미지 처리 실패:", err);
      }
    }
  }

  function removeImage(i: number) {
    pendingImages = pendingImages.filter((_, idx) => idx !== i);
  }

  async function send(e: Event) {
    e.preventDefault();
    if (!client || !selected || sending) return;
    if (!draft.trim() && pendingImages.length === 0) return;
    const text = draft;
    const imgs = pendingImages.map((p) => p.att);
    draft = "";
    pendingImages = [];
    sending = true;
    try {
      await client.sendChat(selected, text, imgs);
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
  {#if connected}
    <span class="dot" class:on={online}></span>
    <span class="status">{online ? "브릿지 온라인" : "브릿지 오프라인"} · {status}</span>
  {:else}
    <span class="status">{status}</span>
  {/if}
  <span class="spacer"></span>
  {#if !standalone && (installPrompt || isIos)}
    <button onclick={installApp}>📲 앱 설치</button>
  {/if}
  {#if pairing}
    <button onclick={showPhoneQr}>📱 폰에서 열기</button>
    <button onclick={unpair}>연결 해제</button>
  {/if}
</header>

{#if qrUrl}
  <div
    class="qr-overlay"
    role="button"
    tabindex="0"
    onclick={() => (qrUrl = null)}
    onkeydown={(e) => e.key === "Escape" && (qrUrl = null)}
  >
    <div class="qr-card" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <h3>폰에서 열기</h3>
      <p class="muted">폰 카메라로 QR을 찍으면 이 화면이 폰에서 열립니다.</p>
      <img src={qrUrl} alt="페어링 QR" width="280" height="280" />
      <p class="muted small">같은 페어링(같은 namespace) — e2eeKey가 들어있으니 본인 기기만.</p>
      <button onclick={() => (qrUrl = null)}>닫기</button>
    </div>
  </div>
{/if}

{#if showIosHint}
  <div class="qr-overlay" role="button" tabindex="0" onclick={() => (showIosHint = false)} onkeydown={() => {}}>
    <div class="qr-card" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <h3>홈 화면에 추가</h3>
      <p class="muted">Safari 하단 <strong>공유</strong> 버튼 → <strong>홈 화면에 추가</strong>를 누르세요.</p>
      <button onclick={() => (showIosHint = false)}>닫기</button>
    </div>
  </div>
{/if}

{#if !pairing}
  <main class="empty">
    <h2>페어링이 필요합니다</h2>
    <p>Mac에서 <code>decku pair</code> (또는 <code>decku run</code>) 실행 → 표시되는 QR을 아래 카메라로 찍거나, 폰 기본 카메라로 찍어 여세요.</p>

    {#if scanning}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={videoEl} autoplay playsinline muted class="scanner"></video>
      <p class="muted">decku QR을 카메라에 비추세요…</p>
      <button onclick={stopScan}>취소</button>
    {:else}
      <button class="primary" onclick={startScan}>📷 카메라로 페어링</button>
    {/if}
    {#if scanError}<p class="err">{scanError}</p>{/if}
  </main>
{:else}
  <div class="layout">
    <aside>
      <div class="tabs">
        <button class:sel={view === "live"} onclick={() => (view = "live")}>● Live {sessions.length}</button>
        <button class:sel={view === "history"} onclick={openHistory}>기록</button>
      </div>

      {#if view === "live"}
        {#if connected && !online}
          <p class="offline-hint">브릿지가 꺼져 있어요. Mac에서 <code>decku run</code> 확인.</p>
        {:else if sessions.length === 0}
          <p class="muted">대기 중…</p>
        {/if}
        {#each sessions as s (s.sessionId)}
          <button class="session" class:active={selected === s.sessionId} onclick={() => open(s.sessionId)}>
            <span class="cwd">{s.title ?? cwdName(s.cwd)}</span>
            <span class="path">{cwdName(s.cwd)}</span>
          </button>
        {/each}
      {:else}
        {#if historyLoading}<p class="muted">기록 불러오는 중…</p>{/if}
        {#each history as s (s.sessionId)}
          <button class="session" class:active={selected === s.sessionId} onclick={() => open(s.sessionId)}>
            <span class="cwd">{s.live ? "● " : ""}{s.title ?? cwdName(s.cwd)}</span>
            <span class="path">{cwdName(s.cwd)}</span>
          </button>
        {/each}
      {/if}
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
        {#if pendingImages.length > 0}
          <div class="thumbs">
            {#each pendingImages as p, i (i)}
              <div class="thumb">
                <img src={p.url} alt="첨부" />
                <button type="button" class="rm" onclick={() => removeImage(i)}>×</button>
              </div>
            {/each}
          </div>
        {/if}
        <form class="composer" onsubmit={send}>
          <label class="attach" title="이미지 첨부">
            🖼
            <input type="file" accept="image/*" multiple onchange={addImages} hidden />
          </label>
          <input bind:value={draft} placeholder="메시지 입력 (이미지 첨부 가능)…" disabled={sending} />
          <button type="submit" disabled={(!draft.trim() && pendingImages.length === 0) || sending}>
            {sending ? "…" : "전송"}
          </button>
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
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #c00; display: inline-block; }
  .dot.on { background: #1a9d3b; }
  .offline-hint { color: #b00; font-size: 0.8rem; padding: 0.4rem 0.5rem; background: #fff4f4; border-radius: 6px; }
  header button { font-size: 0.8rem; }
  .spacer { margin-left: auto; }
  .scanner { width: 100%; max-width: 360px; border-radius: 10px; background: #000; margin: 0.5rem 0; }
  .primary { padding: 0.6rem 1.2rem; border-radius: 8px; border: 1px solid #1a73e8; background: #1a73e8; color: #fff; font-size: 0.95rem; cursor: pointer; }
  .err { color: #b00; }
  .qr-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 50; }
  .qr-card { background: #fff; border-radius: 12px; padding: 1.5rem; text-align: center; max-width: 90vw; }
  .qr-card h3 { margin: 0 0 0.3rem; }
  .qr-card img { display: block; margin: 0.75rem auto; }
  .qr-card .small { font-size: 0.72rem; }
  .qr-card button { margin-top: 0.5rem; padding: 0.4rem 1.2rem; }
  .empty { max-width: 36rem; margin: 4rem auto; padding: 0 1rem; font-family: system-ui, sans-serif; }
  .layout { display: grid; grid-template-columns: 18rem 1fr; height: calc(100vh - 49px); font-family: system-ui, sans-serif; }
  aside { border-right: 1px solid #e5e5e5; overflow-y: auto; padding: 0.5rem; }
  .tabs { display: flex; gap: 0.3rem; padding: 0.4rem 0.5rem; }
  .tabs button { flex: 1; font-size: 0.8rem; padding: 0.35rem; border: 1px solid #ddd; background: #fafafa; border-radius: 6px; cursor: pointer; }
  .tabs button.sel { background: #e8f0fe; border-color: #1a73e8; color: #1a73e8; }
  .session { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 0.5rem; border-radius: 6px; cursor: pointer; }
  .session:hover { background: #f3f3f3; }
  .session.active { background: #e8f0fe; }
  .session .cwd { display: block; font-weight: 600; font-size: 0.9rem; }
  .session .path { display: block; color: #999; font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .convo { display: flex; flex-direction: column; overflow: hidden; }
  .convo .scroll { flex: 1; overflow-y: auto; padding: 1rem 1.5rem; }
  .thumbs { display: flex; gap: 0.4rem; padding: 0.4rem 1rem 0; flex-wrap: wrap; }
  .thumb { position: relative; }
  .thumb img { height: 56px; border-radius: 6px; display: block; }
  .thumb .rm { position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; border-radius: 50%; border: 0; background: #333; color: #fff; cursor: pointer; line-height: 1; padding: 0; }
  .composer { display: flex; gap: 0.5rem; padding: 0.6rem 1rem; border-top: 1px solid #e5e5e5; align-items: center; }
  .attach { cursor: pointer; font-size: 1.2rem; user-select: none; }
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
