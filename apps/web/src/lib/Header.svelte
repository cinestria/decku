<script lang="ts">
  // 정보 페이지(faq·docs)용 공유 스티키 헤더. 홈은 페어링 컨트롤이 있어 자체 헤더 사용.
</script>

<header class="dk-header">
  <a class="brand" href="/"><span class="logo">d</span>decku</a>
  <span class="spacer"></span>
  <a class="nav" href="/docs">Doc</a>
  <a class="nav" href="/faq">FAQ</a>
</header>

<style>
  .dk-header {
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.55rem 1rem; border-bottom: 1px solid var(--border);
    font-family: system-ui, -apple-system, sans-serif; background: var(--bg);
    position: sticky; top: 0; z-index: 10;
  }
  .brand { display: flex; align-items: center; gap: 0.45rem; font-weight: 700; font-size: 1.05rem; letter-spacing: -0.01em; color: var(--text); text-decoration: none; }
  .logo { width: 24px; height: 24px; border-radius: 7px; background: var(--accent); color: #fff; display: grid; place-items: center; font-weight: 800; }
  .spacer { margin-left: auto; }
  .nav { font-size: 0.8rem; padding: 0.35rem 0.7rem; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 8px; text-decoration: none; font-weight: 500; }
  .nav:hover { background: var(--surface); }
</style>
