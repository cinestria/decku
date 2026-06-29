<svelte:head><title>decku · Docs</title></svelte:head>

<main class="docs">
  <header class="dhead">
    <h1>명령어 문서</h1>
    <p class="muted">
      Mac에 작은 브릿지를 띄워 Claude 세션을 웹앱에 연결합니다. 명령은 딱 하나 —
      <code>decku</code> (설치 없이 <code>npx @decku/cli</code>) 만 실행하면 처음엔 자동으로 페어링하고 바로 중계를 시작합니다.
    </p>
  </header>

  <section class="block">
    <h2>빠른 시작</h2>
    <pre class="cmd"><code># 설치 없이 바로 (필요 시 자동 페어링 → QR 출력 → watch)
npx @decku/cli

# 또는 전역 설치 후 decku 한 줄
npm i -g @decku/cli
decku</code></pre>
    <p class="muted small">Node 20+ 필요. 처음 실행하면 QR이 뜨고, 폰·브라우저로 한 번 스캔하면 연결됩니다. 이후엔 페어링이 저장돼 <code>decku</code> 만으로 재연결돼요.</p>
  </section>

  <section class="block">
    <h2><code>decku</code> <span class="muted">(= <code>decku run</code>)</span></h2>
    <p>기본 명령입니다. 페어링이 없으면 <strong>자동으로 페어링</strong>(QR 출력)한 뒤, Claude 세션을 감시(watch)하고 목록·대화를 E2EE로 암호화해 실시간 중계합니다.</p>
    <pre class="cmd"><code>decku                      # 페어링(필요 시) + watch + 중계
decku run &lt;sessionId&gt;       # 특정 세션만
decku --from-start         # 처음부터 전체 기록 백필 (-a 와 동일)
decku --console            # 중계 없이 로컬 콘솔에서 목록·tail만</code></pre>
    <table class="opts">
      <tbody>
        <tr><td><code>&lt;sessionId&gt;</code></td><td>특정 세션 ID만 대상으로. 생략 시 모든 세션.</td></tr>
        <tr><td><code>--from-start</code>, <code>-a</code></td><td>세션 시작부터 전체 transcript를 백필. 기본은 최근 위주.</td></tr>
        <tr><td><code>--console</code></td><td>중계·페어링 없이 로컬에서만 목록·실시간 tail 확인 (디버그용).</td></tr>
      </tbody>
    </table>
    <p class="muted small">목록이 비어 있으면 그 Mac에 <code>claude</code> CLI와 실제 Claude 세션이 있는지 확인하세요.</p>
  </section>

  <section class="block">
    <h2><code>decku pair</code></h2>
    <p>첫 페어링은 <code>decku</code> 실행 시 자동으로 되므로 보통 직접 칠 일은 없습니다. <strong>재페어링</strong>하거나 QR을 다시 보고 싶을 때 사용해요.</p>
    <pre class="cmd"><code>decku pair                      # 저장된 페어링 재사용 + QR 다시 출력
decku pair --new                # 기존 페어링 버리고 새 namespace 발급
decku pair --new --expire-days 7  # 7일 후 만료되는 페어링
decku pair --url &lt;webUrl&gt;        # 다른 웹 주소로 페어링</code></pre>
    <table class="opts">
      <tbody>
        <tr><td><code>--new</code></td><td>저장된 페어링을 무시하고 새 namespace·키를 발급. 기존 기기 연결은 끊깁니다.</td></tr>
        <tr><td><code>--expire-days &lt;N&gt;</code></td><td>N일 후 만료되는 페어링(<code>--new</code>와 함께). 만료되면 재연결 불가 → 다시 페어링. <strong>기본은 무제한</strong>(상시 실행이 끊기지 않도록).</td></tr>
        <tr><td><code>--url &lt;webUrl&gt;</code></td><td>연결할 웹앱 주소. 생략 시 <code>https://decku.app</code> (환경변수 <code>DECKU_URL</code> 로도 지정 가능).</td></tr>
      </tbody>
    </table>
  </section>

  <section class="block">
    <h2><code>decku install</code> / <code>uninstall</code></h2>
    <p>macOS launchd에 등록해 <strong>로그인할 때 브릿지가 자동 실행</strong>되게 합니다. 매번 터미널을 열 필요가 없어요.</p>
    <pre class="cmd"><code>decku install     # 로그인 시 자동 시작 등록 (먼저 pair 필요)
decku uninstall   # 자동 시작 해제</code></pre>
    <p class="muted small">전역 설치(<code>npm i -g @decku/cli</code>) 후 사용하길 권장합니다. <code>install</code> 전에 <code>decku pair</code> 로 페어링이 되어 있어야 합니다.</p>
  </section>

  <section class="block">
    <h2>환경변수</h2>
    <table class="opts">
      <tbody>
        <tr><td><code>DECKU_URL</code></td><td><code>pair</code> 기본 웹 주소를 덮어씁니다. <code>--url</code> 플래그가 우선.</td></tr>
      </tbody>
    </table>
  </section>

  <p class="more">막히는 부분은 <a href="/faq">FAQ</a> 를 확인하세요.</p>
</main>

<style>
  .docs { max-width: 40rem; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; font-family: system-ui, -apple-system, sans-serif; }
  .dhead { margin-bottom: 2rem; }
  .dhead h1 { font-size: 1.7rem; letter-spacing: -0.02em; margin: 0 0 0.6rem; }
  .dhead p { line-height: 1.65; margin: 0; }

  .block { margin-bottom: 2.25rem; }
  .block > h2 { font-size: 1.15rem; margin: 0 0 0.5rem; }
  .block > p { line-height: 1.7; margin: 0 0 0.7rem; }

  .cmd { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 0.85rem 1rem; overflow-x: auto; margin: 0.6rem 0; }
  .cmd code { background: none; padding: 0; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.84rem; color: var(--text); white-space: pre; line-height: 1.6; }

  .opts { width: 100%; border-collapse: collapse; margin: 0.6rem 0; font-size: 0.9rem; }
  .opts td { padding: 0.5rem 0.6rem; border-top: 1px solid var(--border); vertical-align: top; line-height: 1.55; }
  .opts td:first-child { white-space: nowrap; width: 1%; padding-right: 1rem; }
  .opts td:last-child { color: var(--muted); }

  .small { font-size: 0.82rem; }
  .more { margin-top: 1rem; text-align: center; color: var(--muted); font-size: 0.88rem; }

  code { background: var(--surface-2); padding: 0.1rem 0.35rem; border-radius: 5px; font-size: 0.86em; font-family: ui-monospace, SFMono-Regular, monospace; word-break: break-word; }
  h2 code, .opts code { background: var(--surface-2); }
  strong { font-weight: 600; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
