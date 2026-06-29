<script lang="ts">
  const faqs: { q: string; a: string }[] = [
    {
      q: "decku가 뭔가요?",
      a: "Mac에서 돌아가는 Claude 세션을 폰·브라우저에서 실시간으로 보고, 그 자리에서 이어 대화하는 도구예요. Mac에 작은 브릿지(<code>decku</code>)를 띄우고, QR로 한 번 페어링하면 끝입니다.",
    },
    {
      q: "안전한가요? 내 대화가 서버에 저장되나요?",
      a: "대화는 <b>종단간 암호화(E2EE)</b>로 중계됩니다. 암호화 키는 QR 안에만 들어 있고 서버로는 전송되지 않아요. 중계 서버(Supabase)를 지나는 건 복호화 불가능한 암호문뿐이라, 운영자도 내용을 볼 수 없습니다.",
    },
    {
      q: "로그인이 왜 없나요?",
      a: "계정 대신 <b>페어링 namespace 자체가 자격증명</b>입니다. QR을 가진 기기만 그 세션에 접근할 수 있어요. 로그인 단계가 없어 빠르지만, QR(특히 그 안의 키)은 본인 기기에서만 열어야 합니다.",
    },
    {
      q: "설치가 꼭 필요한가요?",
      a: "아니요. Node만 있으면 설치 없이 <code>npx @decku/cli</code> 로 바로 됩니다 — 처음 실행하면 자동으로 페어링 QR이 떠요. 자주 쓴다면 <code>npm i -g @decku/cli</code> 로 전역 설치하면 <code>decku</code> 한 줄로 실행할 수 있어요.",
    },
    {
      q: "비용이 드나요?",
      a: "decku 자체는 무료입니다. Claude 사용료는 별개로, 기존에 쓰던 Claude 구독/요금 그대로예요.",
    },
    {
      q: "세션 목록이 안 떠요 / '오프라인'으로 나와요.",
      a: "Mac에서 브릿지(<code>decku</code>)가 떠 있는지 먼저 확인하세요. 그리고 그 Mac에 <code>claude</code> CLI와 실제 Claude 세션이 있어야 목록에 나옵니다. 브릿지는 그 머신의 세션을 읽어 중계하는 구조라, 세션이 없으면 목록도 비어 있어요.",
    },
    {
      q: "npm i -g 할 때 EEXIST(file already exists) 오류가 나요.",
      a: "이전에 로컬 빌드로 설치한 흔적이 남아 충돌하는 경우예요. <code>npm rm -g @decku/cli</code> (또는 옛 이름 <code>@decku/bridge</code>) 후 <code>rm -f /opt/homebrew/bin/decku</code> 로 잔여 파일을 지우고 다시 설치하세요. 급하면 <code>npm i -g @decku/cli --force</code> 로 덮어써도 됩니다.",
    },
    {
      q: "회사망에서 npm이 ETIMEDOUT으로 설치가 안 돼요.",
      a: "사내 방화벽이 <code>registry.npmjs.org</code>를 막은 경우가 많아요. 사내 프록시/미러를 IT에 확인하거나(<code>npm config set registry &lt;사내미러&gt;</code>), 개인 핫스팟 같은 다른 망에서 한 번 설치하면 이후엔 그 망 없이도 <code>decku</code>가 실행됩니다.",
    },
    {
      q: "여러 기기에서 같이 볼 수 있나요?",
      a: "네. 웹 헤더의 <b>📱 폰 추가</b> 버튼으로 현재 페어링을 QR로 띄우고, 다른 기기 카메라로 찍으면 같은 세션을 함께 볼 수 있어요. 같은 namespace·같은 키를 공유하므로 본인 기기끼리만 하세요.",
    },
    {
      q: "페어링을 해제하려면?",
      a: "웹 헤더의 <b>해제</b> 버튼을 누르면 이 기기에 저장된 페어링 정보가 지워집니다. 새로 시작하려면 Mac에서 <code>decku pair --new</code> 로 새 페어링을 만드세요.",
    },
  ];
</script>

<svelte:head><title>decku · FAQ</title></svelte:head>

<main class="faq">
  <header class="fhead">
    <h1>자주 묻는 질문</h1>
  </header>

  <div class="list">
    {#each faqs as f, i (i)}
      <details class="item" open={i === 0}>
        <summary>{f.q}</summary>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="ans">{@html f.a}</div>
      </details>
    {/each}
  </div>

  <p class="more">
    더 궁금한 점이 있으면 <a href="/">decku 시작하기</a> 에서 페어링부터 해보세요.
  </p>
</main>

<style>
  .faq { max-width: 36rem; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; font-family: system-ui, -apple-system, sans-serif; }
  .fhead { margin-bottom: 1.75rem; }
  .fhead h1 { font-size: 1.7rem; letter-spacing: -0.02em; margin: 0; }

  .list { display: grid; gap: 0.6rem; }
  .item { border: 1px solid var(--border); border-radius: 13px; background: var(--surface); overflow: hidden; }
  summary { cursor: pointer; padding: 0.95rem 1.1rem; font-weight: 600; font-size: 0.98rem; list-style: none; display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
  summary::-webkit-details-marker { display: none; }
  summary::after { content: "+"; color: var(--muted); font-weight: 400; font-size: 1.25rem; line-height: 1; flex: none; }
  .item[open] summary::after { content: "−"; }
  .item[open] summary { color: var(--accent); }
  .ans { padding: 0 1.1rem 1.05rem; color: var(--muted); line-height: 1.7; font-size: 0.92rem; }

  .more { margin-top: 2rem; text-align: center; color: var(--muted); font-size: 0.88rem; }
  .more a, .ans :global(a) { color: var(--accent); text-decoration: none; }
  .more a:hover, .ans :global(a):hover { text-decoration: underline; }
  .ans :global(code) { background: var(--surface-2); padding: 0.1rem 0.35rem; border-radius: 5px; font-size: 0.86em; font-family: ui-monospace, SFMono-Regular, monospace; word-break: break-word; }
  .ans :global(b) { color: var(--text); font-weight: 600; }
</style>
