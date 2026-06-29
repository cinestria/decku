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
  // 낙관적 전송용 마커(_id 있으면 내가 방금 보낸 것: _pending=스피너, 확인=✓, _failed=⚠)
  type UiEvent = RenderEvent & { _id?: string; _pending?: boolean; _failed?: boolean };
  let events = $state<UiEvent[]>([]);
  let loading = $state(false);
  let thinking = $state(false); // 보낸 뒤 응답(assistant) 도착 전까지 "생각 중…"
  let thinkTimer: ReturnType<typeof setTimeout> | null = null;
  let draft = $state("");
  let pendingImages = $state<{ att: ImageAttachment; url: string }[]>([]);
  let client: DeckuClient | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let qrUrl = $state<string | null>(null); // QR 오버레이 (폰에서 열기)
  let menuOpen = $state(false); // 모바일 헤더 ☰ 메뉴
  let origin = $state("https://decku.app"); // 설치 안내 URL (SSR 폴백)
  // decku.app(기본 도메인)이면 --url 생략, 아니면 명시. 서브커맨드 없이 실행 → 필요 시 자동 페어링 후 중계
  let pairCmd = $derived(
    origin === "https://decku.app" ? "npx @decku/cli" : `npx @decku/cli --url ${origin}`,
  );

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

  // 헤더에 표시할 현재 세션 제목
  let selectedTitle = $derived.by(() => {
    if (!selected) return "";
    const s = [...sessions, ...history].find((x) => x.sessionId === selected);
    return s ? (s.title ?? cwdName(s.cwd)) : "세션";
  });

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
    const link = `${location.origin}/#ns=${pairing.ns}&k=${pairing.k}${pairing.t ? `&t=${pairing.t}` : ""}`;
    qrUrl = await QRCode.toDataURL(link, { width: 280, margin: 2 });
  }

  onMount(async () => {
    origin = location.origin;
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
    try {
      await startRealtime(p);
    } catch (e) {
      status = "연결 실패: " + (e as Error).message;
    }
    // heartbeat 기반 온라인 판정 (브릿지가 ~4s마다 목록 재전송)
    heartbeatTimer = setInterval(() => {
      online = lastSeen > 0 && Date.now() - lastSeen < 12000;
    }, 2000);

    // 폰 화면 껐다 켜기/탭 복귀: 백그라운드에서 웹소켓이 끊겼다면 재연결
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    window.addEventListener("pageshow", onWake);
  });

  let reconnecting = $state(false);

  async function startRealtime(p: Pairing): Promise<void> {
    client = new DeckuClient(p);
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
  }

  /** 화면 복귀 시: 한 번이라도 연결됐었는데 heartbeat가 끊겼으면(=오프라인) 재연결. */
  function onWake(): void {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    const stale = lastSeen > 0 && Date.now() - lastSeen > 12000;
    if (stale) void reconnect();
  }

  async function reconnect(): Promise<void> {
    if (!pairing || reconnecting) return;
    reconnecting = true;
    try {
      await client?.stop().catch(() => {});
      await startRealtime(pairing);
      if (selected) await loadSession(selected); // tx 채널 재구독 + 백필
    } catch (e) {
      status = "재연결 실패: " + (e as Error).message;
    } finally {
      reconnecting = false;
    }
  }

  onDestroy(() => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      window.removeEventListener("pageshow", onWake);
    }
    stopScan();
    void client?.stop();
  });

  // 역방향 lazy 백필 상태
  let oldestIndex = $state(0); // 현재 로드된 가장 옛 이벤트의 전체 인덱스
  let hasMore = $state(false); // 더 옛날이 있나
  let loadingOlder = $state(false);

  async function loadSession(sid: string) {
    if (!client) return;
    selected = sid;
    events = [];
    loading = true;
    setThinking(false);
    stick = true; // 열면 최신(바닥)으로
    oldestIndex = 0;
    hasMore = false;
    loadingOlder = false;
    await client.openSession(sid, onTx);
  }

  function onTx(tx: TxPayload) {
    if (tx.firstIndex != null) {
      // backfill 배치
      oldestIndex = tx.firstIndex;
      hasMore = tx.firstIndex > 0;
      if (loadingOlder) {
        prependOlder(tx.events); // 위로 스와이프 → 앞에 붙이고 스크롤 보존 (loadingOlder는 복원 후 해제)
      } else {
        events = tx.events; // 초기 tail → 교체
        loading = false;
      }
    } else {
      ingestLive(tx.events); // 라이브 append (낙관적 메시지 ✓/⚠ 조정)
    }
    if (tx.done) loading = false;
  }

  /** 옛 이벤트를 앞에 붙이되, 보이는 스크롤 위치는 그대로 유지. */
  function prependOlder(older: RenderEvent[]) {
    const el = scrollEl;
    const before = el?.scrollHeight ?? 0;
    events = [...older, ...events];
    void tick().then(() => {
      if (el) {
        el.scrollTop += el.scrollHeight - before; // 늘어난 높이만큼 내려 위치 보존
        updateThumb();
      }
      loadingOlder = false; // 위치 복원 뒤 해제 → 즉시 재트리거 방지
    });
  }

  function loadOlder() {
    if (!client || !selected || loadingOlder || !hasMore) return;
    loadingOlder = true;
    void client.loadOlder(selected, oldestIndex).catch(() => (loadingOlder = false));
  }

  // ── 스크롤: 열 때 바닥, 드래그 가능한 커스텀 스크롤바 ──
  let scrollEl = $state<HTMLElement>();
  let thumbTop = $state(0);
  let thumbH = $state(0);
  let scrollPct = $state(0);
  let overflow = $state(false);
  let stick = true; // 바닥에 붙어있나
  const TRACK_INSET = 12;

  function updateThumb() {
    const el = scrollEl;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    // 위로 스와이프해서 상단 근처 도달 → 옛 청크 로드 (prepend가 위치 보존하므로 연쇄 안 됨)
    if (scrollTop < 48 && hasMore && !loadingOlder && !loading) loadOlder();
    overflow = scrollHeight > clientHeight + 4;
    stick = scrollHeight - scrollTop - clientHeight < 120;
    if (!overflow) return;
    const trackH = clientHeight - TRACK_INSET;
    thumbH = Math.max(30, (clientHeight / scrollHeight) * trackH);
    const room = trackH - thumbH;
    const max = scrollHeight - clientHeight;
    thumbTop = max > 0 ? (scrollTop / max) * room : 0;
    scrollPct = max > 0 ? Math.round((scrollTop / max) * 100) : 0;
  }

  $effect(() => {
    void events.length; // 의존성
    void thinking; // '생각 중' 표시도 바닥으로 스크롤
    if (!scrollEl) return;
    void tick().then(() => {
      if (!scrollEl) return;
      if (stick) scrollEl.scrollTop = scrollEl.scrollHeight;
      updateThumb();
    });
  });

  let dragging = false;
  let dragStartY = 0;
  let dragStartTop = 0;
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

  function onThumbDown(e: PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    dragging = true;
    dragStartY = e.clientY;
    dragStartTop = thumbTop;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onThumbMove(e: PointerEvent) {
    if (!dragging || !scrollEl) return;
    const el = scrollEl;
    const room = el.clientHeight - TRACK_INSET - thumbH;
    const newTop = clamp(dragStartTop + (e.clientY - dragStartY), 0, room);
    el.scrollTop = room > 0 ? (newTop / room) * (el.scrollHeight - el.clientHeight) : 0;
  }
  function onThumbUp(e: PointerEvent) {
    dragging = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  }

  function open(sid: string) {
    if (selected === sid) return;
    void loadSession(sid);
  }

  // 당겨서 새로고침 (모바일)
  let pullY = $state(0);
  let refreshing = $state(false);
  const PULL_MAX = 90;
  const PULL_TRIGGER = 60;

  async function refresh() {
    if (refreshing || !client) return;
    refreshing = true;
    pullY = 0;
    try {
      if (selected) {
        await loadSession(selected);
        const t0 = Date.now();
        while (loading && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 100));
      } else if (view === "history") {
        await client.requestHistory(40);
        await new Promise((r) => setTimeout(r, 600));
      } else {
        await new Promise((r) => setTimeout(r, 400)); // live는 heartbeat가 갱신
      }
    } finally {
      refreshing = false;
    }
  }

  function ptr(node: HTMLElement) {
    let startY = 0;
    let active = false;
    const onStart = (e: TouchEvent) => {
      if (node.scrollTop <= 0 && !refreshing) {
        startY = e.touches[0]!.clientY;
        active = true;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const dy = e.touches[0]!.clientY - startY;
      if (dy > 0) {
        e.preventDefault();
        pullY = Math.min(PULL_MAX, dy * 0.5);
      } else {
        active = false;
        pullY = 0;
      }
    };
    const onEnd = () => {
      if (!active) return;
      active = false;
      if (pullY >= PULL_TRIGGER) void refresh();
      else pullY = 0;
    };
    node.addEventListener("touchstart", onStart, { passive: true });
    node.addEventListener("touchmove", onMove, { passive: false });
    node.addEventListener("touchend", onEnd);
    return {
      destroy() {
        node.removeEventListener("touchstart", onStart);
        node.removeEventListener("touchmove", onMove);
        node.removeEventListener("touchend", onEnd);
      },
    };
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

  function msgText(ev: RenderEvent): string {
    if (ev.kind !== "message") return "";
    return ev.blocks
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .trim();
  }

  /** 라이브 tx 수신: 내가 낙관적으로 띄운 메시지면 중복 추가 대신 ✓ 처리, 실패 메시지면 ⚠ 처리. */
  function ingestLive(incoming: RenderEvent[]) {
    const toAppend: UiEvent[] = [];
    for (const ev of incoming) {
      if (ev.kind === "message" && ev.role === "user") {
        const txt = msgText(ev);
        // 낙관적으로 띄운 내 메시지(_id)가 transcript echo를 모두 흡수 — pending이든 이미 ✓든 중복 추가 안 함
        const opt = events.find((e) => e.kind === "message" && e.role === "user" && e._id && msgText(e) === txt);
        if (opt) {
          if (opt._pending) opt._pending = false; // 첫 echo → ✓
          continue; // 둘째 echo도 흡수(중복 방지)
        }
      }
      if (ev.kind === "message" && ev.role === "assistant") {
        setThinking(false); // 응답 도착 → '생각 중' 해제
        if (msgText(ev).startsWith("⚠ 전송 실패")) {
          const p = [...events].reverse().find((e) => e._pending && e.kind === "message" && e.role === "user");
          if (p) {
            p._pending = false;
            p._failed = true;
          }
        }
      }
      toAppend.push(ev);
    }
    if (toAppend.length) events = [...events, ...toAppend];
  }

  function setThinking(on: boolean) {
    thinking = on;
    if (thinkTimer) clearTimeout(thinkTimer);
    thinkTimer = null;
    if (on) thinkTimer = setTimeout(() => (thinking = false), 130_000); // 안전망(주입 타임아웃 2분)
  }

  async function send(e: Event) {
    e.preventDefault();
    if (!client || !selected) return;
    if (!draft.trim() && pendingImages.length === 0) return;
    const text = draft;
    const imgs = pendingImages.map((p) => p.att);
    draft = "";
    pendingImages = [];

    // 낙관적: 보내자마자 내 말풍선 표시(스피너). transcript echo가 오면 ✓.
    const id = crypto.randomUUID();
    const optimistic: UiEvent = {
      kind: "message",
      role: "user",
      blocks: [...imgs.map(() => ({ type: "image" as const })), ...(text ? [{ type: "text" as const, text }] : [])],
      _id: id,
      _pending: true,
    };
    stick = true;
    events = [...events, optimistic];
    setThinking(true); // 응답 올 때까지 '생각 중…'

    try {
      await client.sendChat(selected, text, imgs);
      // 안전망: 오래도록 확인 안 되면(주입 실패 등) 스피너 → ⚠
      setTimeout(() => {
        const p = events.find((e) => e._id === id && e._pending);
        if (p) {
          p._pending = false;
          p._failed = true;
        }
      }, 90_000);
    } catch {
      setThinking(false);
      const p = events.find((e) => e._id === id);
      if (p) {
        p._pending = false;
        p._failed = true;
      }
    }
  }

  function unpair() {
    clearPairing();
    location.reload();
  }
</script>

<header class:detail={selected}>
  <!-- 모바일 세션 열림: ‹ 목록 + 제목 (iOS 내비게이션) -->
  <span class="hnav">
    <button class="hback" onclick={() => (selected = null)} aria-label="목록으로">‹ 목록</button>
    <span class="htitle">{selectedTitle}</span>
  </span>
  <!-- 모바일: 맨 왼쪽 ☰ (데스크탑은 숨김) -->
  <button class="menu-btn" aria-label="메뉴" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>☰</button>
  <a class="brand" href="/"><span class="logo">d</span>decku</a>
  {#if reconnecting}
    <span class="pill"><span class="dot pulse"></span>연결 중…</span>
  {:else if connected}
    <span class="pill"><span class="dot" class:on={online}></span>{online ? "온라인" : "오프라인"}</span>
  {:else}
    <span class="status">{status}</span>
  {/if}
  <span class="spacer"></span>
  {#if !pairing}
    <button class="cta" onclick={startScan}>📷 페어링</button>
  {/if}
  <!-- 데스크탑: 인라인 / 모바일: ☰ 왼쪽 드롭다운 -->
  <nav class="hdr-actions" class:open={menuOpen}>
    <a class="ghost nav" href="/docs" onclick={() => (menuOpen = false)}>Doc</a>
    <a class="ghost nav" href="/faq" onclick={() => (menuOpen = false)}>FAQ</a>
    {#if !standalone && (installPrompt || isIos)}
      <button class="ghost" onclick={() => { menuOpen = false; installApp(); }}>📲 웹앱 설치</button>
    {/if}
    {#if pairing}
      <button class="ghost" onclick={() => { menuOpen = false; void showPhoneQr(); }}>📱 폰 추가</button>
    {/if}
  </nav>
  {#if pairing}
    <button class="ghost" onclick={unpair}>해제</button>
  {/if}
</header>
{#if menuOpen}
  <div
    class="menu-backdrop"
    role="button"
    tabindex="0"
    aria-label="메뉴 닫기"
    onclick={() => (menuOpen = false)}
    onkeydown={(e) => e.key === "Escape" && (menuOpen = false)}
  ></div>
{/if}

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

{#if scanning}
  <div
    class="qr-overlay"
    role="button"
    tabindex="0"
    onclick={stopScan}
    onkeydown={(e) => e.key === "Escape" && stopScan()}
  >
    <div class="qr-card" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <h3>카메라로 페어링</h3>
      <p class="muted">Mac 터미널에 뜬 decku QR을 카메라에 비추세요.</p>
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={videoEl} autoplay playsinline muted class="scanner"></video>
      {#if scanError}<p class="err">{scanError}</p>{/if}
      <button onclick={stopScan}>취소</button>
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
  <main class="landing">
    <section class="hero">
      <div class="hero-logo">d</div>
      <h1>내 Claude 세션을<br />어디서든 손안에</h1>
      <p class="lead">
        Mac에서 돌아가는 Claude 세션을 폰·브라우저에서 실시간으로 보고, 그 자리에서 이어 대화하세요.
      </p>
      <div class="badges">
        <span class="badge">⚡ 로그인 없음</span>
        <span class="badge">🔒 종단간 암호화</span>
        <span class="badge">💸 무료</span>
      </div>
    </section>

    <section class="features">
      <div class="feat"><span class="fi">📺</span><div><b>떠 있는 세션 그대로</b><span>새로 만든 게 아니라, 지금 Mac에서 작업 중인 세션을 그대로 미러링.</span></div></div>
      <div class="feat"><span class="fi">💬</span><div><b>이어서 대화</b><span>폰에서 보낸 메시지·이미지가 그 세션에 그대로 주입됩니다.</span></div></div>
      <div class="feat"><span class="fi">🔒</span><div><b>나만 읽는다</b><span>암호화 키는 QR 안에만. 서버를 지나는 건 암호문뿐입니다.</span></div></div>
    </section>

    <section class="steps">
      <div class="step">
        <span class="num">1</span>
        <div class="step-body">
          <h2>Mac에서 브릿지 실행</h2>
          <p class="muted">Node만 있으면 설치 없이 바로:</p>
          <pre class="cmd"><code>{pairCmd}</code></pre>
          <p class="muted small">자주 쓴다면 전역 설치 후 <code>decku</code> 명령으로:</p>
          <pre class="cmd"><code>npm i -g @decku/cli
decku</code></pre>
        </div>
      </div>

      <div class="step">
        <span class="num">2</span>
        <div class="step-body">
          <h2>QR로 페어링</h2>
          <p class="muted">터미널에 뜬 QR을 폰 기본 카메라로 찍거나, 아래 버튼으로 이 기기 카메라로 스캔하세요.</p>
          <button class="primary" onclick={startScan}>📷 카메라로 페어링</button>
        </div>
      </div>
    </section>

    <footer class="lfoot">© decku · <a href="https://github.com/cinestria/decku" target="_blank" rel="noreferrer">GitHub</a></footer>
  </main>
{:else}
  <div class="layout" class:has-sel={selected}>
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
        <div class="ptr" class:settle={!refreshing && pullY === 0} style="height:{refreshing ? 42 : pullY}px">
          <span class="spinner" class:spin={refreshing} style="transform:rotate({pullY * 4}deg);opacity:{refreshing || pullY > 4 ? 1 : 0}"></span>
        </div>
        <div class="scroll-wrap">
          <div id="convo-scroll" class="scroll" use:ptr bind:this={scrollEl} onscroll={updateThumb}>
            {#if loading}<p class="muted">불러오는 중…</p>{/if}
            {#if loadingOlder}
              <p class="muted older-hint">이전 대화 불러오는 중…</p>
            {:else if hasMore}
              <button class="older-btn" onclick={loadOlder}>↑ 이전 대화 더보기</button>
            {/if}
            {#each events as ev, i (i)}
              {#if ev.kind === "message"}
                {@const real = ev.blocks.filter((b) => b.type === "text" || b.type === "thinking" || b.type === "image")}
                {@const tools = ev.blocks.filter((b) => b.type === "tool_use" || b.type === "tool_result")}
                {#if real.length}
                  <div class="msg {ev.role}">
                    <div class="bubble">
                      {#each real as b}
                        {#if b.type === "text"}<p>{b.text}</p>
                        {:else if b.type === "thinking"}<p class="thinking">{b.text}</p>
                        {:else if b.type === "image"}<p class="tool">🖼 이미지</p>{/if}
                      {/each}
                      {#if ev._id}
                        <span class="sendstat" class:failed={ev._failed}>
                          {#if ev._pending}<span class="mini-spin"></span>
                          {:else if ev._failed}⚠ 실패
                          {:else}✓{/if}
                        </span>
                      {/if}
                    </div>
                  </div>
                {/if}
                <!-- 툴 호출/결과는 사용자·어시스턴트 버블 밖, 중립 행으로 (결과는 role:user로 와도 파란 버블 X) -->
                {#each tools as b}
                  {#if b.type === "tool_use"}
                    <div class="toolrow tool">⚙ {b.name}{b.summary ? ` ${b.summary}` : ""}</div>
                  {:else if b.type === "tool_result" && b.text.trim()}
                    <div class="toolrow">
                      <details class="toolres">
                        <summary>↳ 결과 ({b.text.split("\n").length}줄)</summary>
                        <pre>{b.text.slice(0, 4000)}</pre>
                      </details>
                    </div>
                  {/if}
                {/each}
              {/if}
            {/each}
            {#if thinking}
              <div class="msg assistant">
                <div class="bubble think">
                  <span class="dots"><i></i><i></i><i></i></span>
                  <span class="think-label">생각 중…</span>
                </div>
              </div>
            {/if}
          </div>
          {#if overflow}
            <div class="scrollbar">
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="sb-thumb"
                role="scrollbar"
                aria-controls="convo-scroll"
                aria-orientation="vertical"
                aria-valuenow={scrollPct}
                aria-valuemin="0"
                aria-valuemax="100"
                tabindex="0"
                style="height:{thumbH}px;transform:translateY({thumbTop}px)"
                onpointerdown={onThumbDown}
                onpointermove={onThumbMove}
                onpointerup={onThumbUp}
                onpointercancel={onThumbUp}
              ></div>
            </div>
          {/if}
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
          <label class="attach" title="이미지 첨부" aria-label="이미지 첨부">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <circle cx="8.5" cy="8.5" r="1.6" />
              <path d="M21 14.5l-4.5-4.5L5 21.5" />
            </svg>
            <input type="file" accept="image/*" multiple onchange={addImages} hidden />
          </label>
          <input bind:value={draft} placeholder="메시지 입력…" />
          <button type="submit" class="send" aria-label="전송" disabled={!draft.trim() && pendingImages.length === 0}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </form>
      {/if}
    </section>
  </div>
{/if}

<style>
  header {
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.55rem 1rem; border-bottom: 1px solid var(--border);
    font-family: system-ui, -apple-system, sans-serif; background: var(--bg);
    position: sticky; top: 0; z-index: 10;
  }
  .brand { display: flex; align-items: center; gap: 0.45rem; font-weight: 700; font-size: 1.05rem; letter-spacing: -0.01em; color: var(--text); text-decoration: none; }
  .logo { width: 24px; height: 24px; border-radius: 7px; background: var(--accent); color: #fff; display: grid; place-items: center; font-weight: 800; }
  .pill { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.78rem; color: var(--muted); padding: 0.2rem 0.6rem; background: var(--surface); border-radius: 999px; white-space: nowrap; }
  .status { color: var(--muted); font-size: 0.82rem; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--danger); display: inline-block; }
  .dot.on { background: #21b35a; }
  .dot.pulse { background: var(--accent); animation: dotpulse 1s ease-in-out infinite; }
  @keyframes dotpulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
  .spacer { margin-left: auto; }

  button { font-family: inherit; }
  .ghost { font-size: 0.8rem; padding: 0.35rem 0.7rem; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 8px; cursor: pointer; white-space: nowrap; }
  .ghost:hover { background: var(--surface); }
  a.nav { text-decoration: none; display: inline-flex; align-items: center; font-weight: 500; }

  .hdr-actions { display: flex; align-items: center; gap: 0.5rem; }
  .menu-btn { display: none; font-size: 1.1rem; line-height: 1; padding: 0.35rem 0.6rem; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 8px; cursor: pointer; }
  .menu-btn:hover { background: var(--surface); }
  .menu-backdrop { position: fixed; inset: 0; z-index: 9; } /* 헤더(10) 아래 — 헤더 속 드롭다운은 그 위 */

  @media (max-width: 640px) {
    .menu-btn { display: inline-flex; }
    .hdr-actions { display: none; }
    .hdr-actions.open {
      display: flex; flex-direction: column; align-items: stretch; gap: 0.3rem;
      position: absolute; top: calc(100% + 6px); left: 0.7rem; z-index: 20;
      min-width: 9.5rem; padding: 0.45rem; background: var(--bg);
      border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 10px 34px rgba(0,0,0,0.22);
    }
    .hdr-actions.open .ghost, .hdr-actions.open .nav { width: 100%; text-align: left; border: 0; padding: 0.5rem 0.6rem; border-radius: 8px; font-size: 0.9rem; }
  }
  .cta { font-size: 0.8rem; padding: 0.4rem 0.8rem; border: 0; background: var(--accent); color: #fff; border-radius: 8px; cursor: pointer; font-weight: 600; white-space: nowrap; }
  .cta:hover { filter: brightness(1.05); }
  .primary { padding: 0.7rem 1.4rem; border-radius: 10px; border: 0; background: var(--accent); color: #fff; font-size: 0.95rem; font-weight: 600; cursor: pointer; }
  .primary:hover { filter: brightness(1.05); }

  .landing { max-width: 33rem; margin: 0 auto; padding: 3rem 1.5rem 3rem; font-family: system-ui, sans-serif; }
  .hero { text-align: center; }
  .hero-logo { width: 58px; height: 58px; margin: 0 auto 1.1rem; border-radius: 16px; background: var(--accent); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 2rem; box-shadow: 0 10px 30px color-mix(in srgb, var(--accent) 45%, transparent); }
  .hero h1 { font-size: 1.85rem; line-height: 1.2; letter-spacing: -0.025em; margin: 0 0 0.85rem; }
  .lead { color: var(--muted); line-height: 1.65; margin: 0 auto 1.2rem; max-width: 26rem; font-size: 1.02rem; }
  .badges { display: flex; flex-wrap: wrap; gap: 0.4rem; justify-content: center; }
  .badge { font-size: 0.76rem; color: var(--text); background: var(--surface); border: 1px solid var(--border); padding: 0.3rem 0.65rem; border-radius: 999px; }

  .features { display: grid; gap: 0.5rem; margin: 2.5rem 0; }
  .feat { display: flex; gap: 0.85rem; align-items: flex-start; padding: 0.9rem 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 13px; }
  .feat .fi { font-size: 1.35rem; line-height: 1.35; flex: none; }
  .feat b { display: block; font-size: 0.94rem; }
  .feat span:last-child { display: block; color: var(--muted); font-size: 0.83rem; line-height: 1.5; margin-top: 0.15rem; }

  .steps { display: grid; gap: 1.4rem; margin-top: 2.5rem; }
  .step { display: flex; gap: 0.85rem; align-items: flex-start; }
  .step .num { flex: none; width: 26px; height: 26px; border-radius: 50%; background: var(--accent); color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 0.85rem; margin-top: 0.1rem; }
  .step-body { flex: 1; min-width: 0; }
  .step-body h2 { font-size: 1.08rem; margin: 0 0 0.35rem; }
  .step-body > p { margin: 0.2rem 0; }
  .cmd { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 0.8rem 1rem; overflow-x: auto; margin: 0.55rem 0; }
  .cmd code { background: none; padding: 0; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.85rem; color: var(--text); white-space: pre; line-height: 1.5; }
  .small { font-size: 0.8rem; }

  .lfoot { margin-top: 3rem; text-align: center; color: var(--muted); font-size: 0.8rem; }
  .lfoot a { color: var(--accent); text-decoration: none; }
  .lfoot a:hover { text-decoration: underline; }

  .scanner { width: 100%; max-width: 320px; border-radius: 14px; background: #000; margin: 1rem auto; }
  .err { color: var(--danger); }

  /* dvh: 모바일 브라우저 chrome 제외한 실제 높이 → 입력바가 화면 밑으로 안 잘림 */
  .layout { display: grid; grid-template-columns: 17rem 1fr; height: calc(100vh - 50px); height: calc(100dvh - 50px); font-family: system-ui, sans-serif; }
  aside { border-right: 1px solid var(--border); overflow-y: auto; padding: 0.5rem; background: var(--bg); }
  .tabs { display: flex; gap: 0.25rem; padding: 0.3rem; background: var(--surface); border-radius: 10px; margin-bottom: 0.5rem; }
  .tabs button { flex: 1; font-size: 0.8rem; padding: 0.4rem; border: 0; background: transparent; color: var(--muted); border-radius: 7px; cursor: pointer; font-weight: 600; }
  .tabs button.sel { background: var(--bg); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,0.08); }

  .session { display: block; width: 100%; text-align: left; border: 0; background: none; color: var(--text); padding: 0.55rem 0.6rem; border-radius: 10px; cursor: pointer; }
  .session:hover { background: var(--surface); }
  .session.active { background: var(--accent-weak); }
  .session .cwd { display: block; font-weight: 600; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .session .path { display: block; color: var(--muted); font-size: 0.72rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .offline-hint { color: var(--danger); font-size: 0.78rem; padding: 0.5rem 0.6rem; background: color-mix(in srgb, var(--danger) 10%, transparent); border-radius: 8px; }

  .convo { display: flex; flex-direction: column; overflow: hidden; background: var(--bg); }
  .scroll-wrap { position: relative; flex: 1; min-height: 0; display: flex; }
  .scroll { flex: 1; overflow-y: auto; padding: 0.85rem 0.9rem; overscroll-behavior-y: contain; scrollbar-width: none; }
  .scroll::-webkit-scrollbar { display: none; }
  .scrollbar { position: absolute; top: 6px; bottom: 6px; right: 2px; width: 14px; }
  .sb-thumb { position: absolute; right: 3px; width: 7px; border-radius: 4px; background: var(--muted); opacity: 0.4; cursor: grab; touch-action: none; }
  .sb-thumb:active { opacity: 0.7; cursor: grabbing; }
  .ptr { display: flex; align-items: center; justify-content: center; overflow: hidden; flex: none; }
  .ptr.settle { transition: height 0.2s ease; }
  .spinner { width: 22px; height: 22px; border: 2.5px solid var(--border); border-top-color: var(--accent); border-radius: 50%; transition: opacity 0.15s; }
  .spinner.spin { animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .center { text-align: center; margin-top: 4rem; }
  .older-hint { text-align: center; margin: 0.3rem 0 0.8rem; font-size: 0.8rem; }
  .older-btn { display: block; margin: 0.2rem auto 0.9rem; padding: 0.35rem 0.9rem; border: 1px solid var(--border); background: var(--bg); color: var(--muted); border-radius: 999px; font-size: 0.8rem; cursor: pointer; }
  .older-btn:hover { background: var(--surface); color: var(--text); }
  /* iOS 메시지 버블: 17px 텍스트, 둥근 모서리 + 꼬리쪽만 살짝, 시스템 블루/그레이 */
  .msg { display: flex; margin: 0.15rem 0; }
  .msg.user { justify-content: flex-end; }
  .bubble { max-width: 75%; padding: 0.45rem 0.75rem; border-radius: 18px; line-height: 1.35; font-size: 17px; letter-spacing: -0.01em; }
  .msg.user .bubble { background: var(--user-bubble); color: var(--user-text); border-bottom-right-radius: 5px; }
  .msg.assistant .bubble { background: var(--asst-bubble); border-bottom-left-radius: 5px; max-width: 82%; }
  .bubble p { margin: 0.2rem 0; white-space: pre-wrap; word-break: break-word; }
  .bubble p:first-child { margin-top: 0; }
  .bubble p:last-child { margin-bottom: 0; }
  .sendstat { display: block; text-align: right; margin-top: 0.2rem; font-size: 0.7rem; line-height: 1; color: rgba(255, 255, 255, 0.75); }
  .sendstat.failed { color: #ffd9d9; font-weight: 600; }
  .mini-spin { display: inline-block; width: 10px; height: 10px; border: 1.5px solid rgba(255, 255, 255, 0.45); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; vertical-align: middle; }
  .thinking { color: var(--muted); font-style: italic; font-size: 0.92em; }
  .bubble.think { display: inline-flex; align-items: center; gap: 0.5rem; }
  .dots { display: inline-flex; gap: 3px; }
  .dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); display: inline-block; animation: blink 1.2s infinite both; }
  .dots i:nth-child(2) { animation-delay: 0.2s; }
  .dots i:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
  .think-label { color: var(--muted); font-size: 0.85rem; }
  .tool { color: #c07a00; font-family: ui-monospace, monospace; font-size: 0.82rem; }
  @media (prefers-color-scheme: dark) { .tool { color: #e0a64d; } }
  .toolrow { margin: 0.3rem 0; }
  .toolres { margin: 0.2rem 0; }
  .toolres summary { color: var(--muted); font-family: ui-monospace, monospace; font-size: 0.8rem; cursor: pointer; list-style: none; }
  .toolres summary::-webkit-details-marker { display: none; }
  .toolres summary::before { content: "▸ "; }
  .toolres[open] summary::before { content: "▾ "; }
  .toolres pre { margin: 0.35rem 0 0; padding: 0.5rem 0.7rem; background: var(--surface-2); border-radius: 8px; font-size: 0.76rem; line-height: 1.45; overflow-x: auto; white-space: pre-wrap; word-break: break-word; max-height: 16rem; overflow-y: auto; color: var(--muted); }

  .thumbs { display: flex; gap: 0.4rem; padding: 0.5rem 1rem 0; flex-wrap: wrap; }
  .thumb { position: relative; }
  .thumb img { height: 56px; border-radius: 8px; display: block; }
  .thumb .rm { position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; border-radius: 50%; border: 0; background: #000; color: #fff; cursor: pointer; line-height: 1; padding: 0; font-size: 0.8rem; }

  /* 세이프에어리어: iPhone 홈 인디케이터에 안 가리게 하단 여백 */
  .composer { display: flex; gap: 0.5rem; padding: 0.6rem 0.85rem; padding-bottom: calc(0.6rem + env(safe-area-inset-bottom)); border-top: 1px solid var(--border); align-items: center; background: var(--bg); }
  .attach { flex: none; width: 40px; height: 40px; display: grid; place-items: center; border-radius: 50%; color: var(--muted); cursor: pointer; }
  .attach:hover { background: var(--surface); color: var(--text); }
  .attach svg { width: 22px; height: 22px; }
  /* min-width:0: input이 placeholder 폭 밑으로 줄어 버튼을 안 밀어냄. font-size 16px: iOS 포커스 자동확대 방지. 높이 버튼과 일치 */
  .composer input { flex: 1; min-width: 0; height: 40px; padding: 0 1rem; border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 999px; font-size: 16px; outline: none; }
  .composer input:focus { border-color: var(--accent); background: var(--bg); }
  .send { flex: none; width: 40px; height: 40px; display: grid; place-items: center; border-radius: 50%; border: 0; background: var(--accent); color: #fff; cursor: pointer; transition: filter 0.15s, opacity 0.15s; }
  .send svg { width: 20px; height: 20px; }
  .send:hover:not(:disabled) { filter: brightness(1.08); }
  .send:disabled { opacity: 0.4; cursor: default; }

  .muted { color: var(--muted); }
  .qr-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 1rem; }
  .qr-card { background: var(--bg); color: var(--text); border-radius: 16px; padding: 1.75rem; text-align: center; max-width: 90vw; box-shadow: 0 12px 40px rgba(0,0,0,0.25); }
  .qr-card h3 { margin: 0 0 0.4rem; }
  .qr-card img { display: block; margin: 0.9rem auto; border-radius: 10px; }
  .qr-card .small { font-size: 0.72rem; }
  .qr-card button { margin-top: 0.6rem; padding: 0.5rem 1.4rem; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }
  code { background: var(--surface-2); padding: 0.12rem 0.35rem; border-radius: 5px; font-size: 0.88em; }

  /* 헤더 내 세션 내비(‹ 목록 + 제목) — 모바일 세션 열렸을 때만 */
  .hnav { display: none; align-items: center; gap: 0.1rem; min-width: 0; flex: 1; }
  .hback { flex: none; background: none; border: 0; color: var(--accent); font-size: 0.95rem; font-weight: 500; cursor: pointer; padding: 0.25rem 0.3rem 0.25rem 0; white-space: nowrap; }
  .htitle { font-weight: 600; font-size: 0.95rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }

  @media (max-width: 640px) {
    .layout { grid-template-columns: 1fr; }
    /* 모바일: 목록 ↔ 대화 마스터/디테일 */
    .layout:not(.has-sel) .convo { display: none; }
    .layout.has-sel aside { display: none; }
    /* 세션 열림: 헤더를 ‹목록 + 제목 + ☰ 로 (브랜드/상태/해제 숨김) */
    header.detail .brand,
    header.detail .pill,
    header.detail .status,
    header.detail > .ghost { display: none; }
    header.detail .hnav { display: flex; }
  }
</style>
