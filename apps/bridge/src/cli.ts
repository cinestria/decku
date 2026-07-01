/**
 * decku 브릿지 CLI 진입점.
 *
 * 서브커맨드:
 *   pair [--url <webUrl>]   웹앱에서 페어링(namespace+토큰) + e2eeKey 생성 + QR/URL 출력
 *   run [sessionId]         watch + realtime publish (기본). 미페어링 시 콘솔 모드
 *   install / uninstall     부팅 시 자동 시작 등록/해제 (macOS launchd)
 *
 * npm 패키지 `@decku/cli` 로 배포, `npx @decku/cli <cmd>` 로 실행.
 */
import { readFileSync } from "node:fs";
import { run } from "./commands/run.js";
import { pair } from "./commands/pair.js";
import { install, uninstall } from "./commands/install.js";

// 번들된 dist/cli.js 기준 ../package.json (런타임 읽기 → esbuild가 번들 안 함)
const VERSION = (() => {
  try {
    return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
  } catch {
    return "?";
  }
})();

const USAGE = `decku — Claude Desktop 세션을 웹앱에 연결

사용법:
  decku                       페어링(필요 시 자동) + 세션 watch + 중계 — 이것만으로 시작
  decku run                   위와 동일 (명시적). --console 로 로컬 전용 모드
  decku pair                  재페어링/QR 다시 보기 (--new 새 namespace, --url 웹주소)
                              --new --expire-days N: N일 후 만료되는 페어링(기본 무제한)
  decku install               부팅 시 자동 시작 등록 (macOS)
  decku uninstall             자동 시작 해제
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const first = args[0];

  if (first === "-h" || first === "--help" || first === "help") {
    process.stdout.write(USAGE);
    return;
  }
  if (first === "-v" || first === "--version" || first === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  // 서브커맨드가 없거나 첫 토큰이 플래그면 → run (예: `decku`, `decku --url x`, `decku --console`)
  const hasSub = first !== undefined && !first.startsWith("-");
  const cmd = hasSub ? first : "run";
  const rest = hasSub ? args.slice(1) : args;

  switch (cmd) {
    case "run":
      console.log(`\x1b[1mdecku\x1b[0m \x1b[2mv${VERSION}\x1b[0m`);
      await run(rest);
      break;
    case "pair":
      await pair(rest);
      break;
    case "install":
      await install();
      break;
    case "uninstall":
      await uninstall();
      break;
    default:
      process.stderr.write(`알 수 없는 명령: ${cmd}\n\n${USAGE}`);
      process.exitCode = 1;
  }
}

const now = () => new Date().toISOString();
const isAbort = (e: unknown) => (e as { name?: string })?.name === "AbortError";

// 재연결 중 in-flight fetch가 취소되며 나는 AbortError는 정상(무해) → 흡수. 그 외만 로깅.
// (개별 발생 지점에서도 잡지만, 놓친 경로가 있어도 데몬이 죽지 않도록 최종 그물망.)
process.on("unhandledRejection", (reason) => {
  if (isAbort(reason)) {
    console.warn(`[${now()}] unhandledRejection: AbortError(무해, 재연결 중 취소) — 무시하고 계속`);
    return;
  }
  console.error(`[${now()}] unhandledRejection:`, reason);
});

// 예전엔 uncaughtException 핸들러가 없어서 AbortError 하나로 프로세스가 즉사했음.
process.on("uncaughtException", (err) => {
  if (isAbort(err)) {
    console.warn(`[${now()}] uncaughtException: AbortError(무해, 재연결 중 취소) — 무시하고 계속`);
    return;
  }
  console.error(`[${now()}] uncaughtException — 종료:`, err);
  process.exit(1);
});

main().catch((err) => {
  // run.ts의 watch 루프가 AbortError를 자체 흡수하므로 여기까진 정상적으론 안 온다.
  // 그래도 도달했다면 루프는 이미 빠져나온 것 → AbortError라도 그냥 죽이지 말고 크게 로깅.
  // (원래 여기서 무조건 exit(1)로 죽던 버그 지점.)
  if (isAbort(err)) {
    console.error(
      `[${now()}] main(): AbortError가 watch 루프를 뚫고 최상위 도달 — 루프가 멈췄을 수 있음. exit(1).`,
      err,
    );
    process.exit(1);
  }
  console.error(`[${now()}]`, err);
  process.exit(1);
});
