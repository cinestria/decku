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

// 재연결 중 in-flight fetch가 취소되며 나는 AbortError는 정상(무해) → 무시. 그 외만 로깅.
process.on("unhandledRejection", (reason) => {
  const name = (reason as { name?: string })?.name;
  if (name === "AbortError") return;
  console.error("unhandledRejection:", reason);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
