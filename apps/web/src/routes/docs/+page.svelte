<svelte:head><title>decku · Docs</title></svelte:head>

<main class="docs">
  <header class="dhead">
    <h1>명령어 문서</h1>
    <p class="muted">
      Mac에 작은 브릿지를 띄워 Claude 세션을 웹앱에 연결합니다. 설치 없이
      <code>npx @decku/cli &lt;명령&gt;</code>, 또는 전역 설치 후 <code>decku &lt;명령&gt;</code> 로 실행하세요.
    </p>
  </header>

  <section class="block">
    <h2>설치</h2>
    <pre class="cmd"><code># 설치 없이 1회 실행
npx @decku/cli pair

# 전역 설치 → decku 명령 사용
npm i -g @decku/cli</code></pre>
    <p class="muted small">Node 20+ 필요. 전역 설치 시 <code>decku</code> 바이너리가 PATH에 등록됩니다.</p>
  </section>

  <section class="block">
    <h2><code>decku pair</code></h2>
    <p>웹앱과 페어링합니다 — 새 namespace·암호화 키를 만들고 QR과 페어링 URL을 출력해요. QR을 폰 카메라로 찍거나 웹의 카메라 버튼으로 스캔하면 연결됩니다.</p>
    <pre class="cmd"><code>decku pair                 # 기본 https://decku.app 로 페어링
decku pair --url &lt;webUrl&gt;   # 다른 웹 주소 지정
decku pair --new           # 기존 페어링 버리고 새로 발급</code></pre>
    <table class="opts">
      <tbody>
        <tr><td><code>--url &lt;webUrl&gt;</code></td><td>연결할 웹앱 주소. 생략 시 <code>https://decku.app</code> (환경변수 <code>DECKU_URL</code> 로도 지정 가능).</td></tr>
        <tr><td><code>--new</code></td><td>저장된 페어링을 무시하고 새 namespace·키를 발급. 기존 기기 연결은 끊깁니다.</td></tr>
      </tbody>
    </table>
    <p class="muted small">한 번 페어링하면 정보가 로컬에 저장돼, 이후 <code>decku run</code> 만으로 재사용됩니다.</p>
  </section>

  <section class="block">
    <h2><code>decku run</code></h2>
    <p>기본 명령입니다. 페어링된 상태면 Claude 세션을 감시(watch)하고, 목록·대화를 E2EE로 암호화해 실시간 중계합니다. 명령을 생략해도(<code>decku</code>) run이 실행돼요.</p>
    <pre class="cmd"><code>decku run                  # 전체 세션 watch + 실시간 중계
decku run &lt;sessionId&gt;       # 특정 세션만
decku run --from-start      # 처음부터 전체 기록 백필 (-a 와 동일)
decku run --console         # 페어링 없이 로컬 콘솔에서 목록·tail만</code></pre>
    <table class="opts">
      <tbody>
        <tr><td><code>&lt;sessionId&gt;</code></td><td>특정 세션 ID만 대상으로. 생략 시 모든 세션.</td></tr>
        <tr><td><code>--from-start</code>, <code>-a</code></td><td>세션 시작부터 전체 transcript를 백필. 기본은 최근 위주.</td></tr>
        <tr><td><code>--console</code></td><td>중계 없이 로컬에서만 목록·실시간 tail 확인 (페어링 불필요, 디버그용).</td></tr>
      </tbody>
    </table>
    <p class="muted small">목록이 비어 있으면 그 Mac에 <code>claude</code> CLI와 실제 Claude 세션이 있는지 확인하세요.</p>
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
