#!/usr/bin/env node
/**
 * decku 브릿지 CLI 진입점.
 *
 * 서브커맨드:
 *   pair <code>        페어링 코드 제출 → device token 수령·로컬 저장   (M3)
 *   run                watch + realtime 데몬 (기본)                      (M1 읽기 → M3 publish)
 *   install/uninstall  OS별 autostart 등록 (launchd/Task Scheduler/...)  (M5)
 *
 * npm 패키지 `@decku/bridge` 로 배포, `npx @decku/bridge <cmd>` 로 실행.
 */

const USAGE = `decku-bridge — Claude Desktop 세션을 웹앱에 연결

사용법:
  decku-bridge run                  세션 watch + realtime (기본)
  decku-bridge pair <code>          웹앱 페어링 코드로 이 Mac을 계정에 연결
  decku-bridge install              부팅 시 자동 시작 등록
  decku-bridge uninstall            자동 시작 해제
`;

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd ?? "run") {
    case "run":
      // M1: ~/.claude 읽기 → 콘솔. M3: realtime publish.
      await import("./commands/run.js").then((m) => m.run(rest));
      break;
    case "pair":
      console.error("pair: M3에서 구현 예정 (code:", rest[0] ?? "<없음>", ")");
      process.exitCode = 1;
      break;
    case "install":
    case "uninstall":
      console.error(`${cmd}: M5에서 구현 예정`);
      process.exitCode = 1;
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
