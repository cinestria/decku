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
import { run } from "./commands/run.js";
import { pair } from "./commands/pair.js";
import { install, uninstall } from "./commands/install.js";

const USAGE = `decku — Claude Desktop 세션을 웹앱에 연결

사용법:
  decku pair --url <webUrl>   웹앱과 페어링 (QR/URL 출력)
  decku run                   세션 watch + realtime (기본)
  decku install               부팅 시 자동 시작 등록 (macOS)
  decku uninstall             자동 시작 해제
`;

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd ?? "run") {
    case "run":
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
    case "-h":
    case "--help":
    case "help":
      process.stdout.write(USAGE);
      break;
    default:
      process.stderr.write(`알 수 없는 명령: ${cmd}\n\n${USAGE}`);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
