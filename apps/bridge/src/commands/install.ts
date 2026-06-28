/**
 * `decku install` / `uninstall` — 부팅 시 자동 시작.
 *
 * macOS는 launchd(LaunchAgent)로 등록. (Linux=systemd user, Windows=Task Scheduler는 README 안내.)
 * 전제: 전역 설치(`npm i -g @decku/bridge`) 후 사용 — plist가 설치된 cli 경로를 가리키므로.
 *       (npx 임시 경로로는 영속 등록이 불안정.) 페어링(`pair`)도 먼저 해둘 것.
 */
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../lib/config.js";

const LABEL = "com.decku.bridge";

function plistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

function notMac(): boolean {
  if (platform() === "darwin") return false;
  console.error(
    "install: 현재 macOS(launchd)만 자동 지원.\n" +
      "  Linux: systemd user 서비스로 `decku run` 등록\n" +
      "  Windows: 작업 스케줄러에 `decku run` 등록\n" +
      "  (자세한 건 README)",
  );
  process.exitCode = 1;
  return true;
}

export async function install(): Promise<void> {
  if (notMac()) return;

  if (!(await loadConfig())) {
    console.error("페어링이 먼저 필요합니다: decku pair --url <webUrl>");
    process.exitCode = 1;
    return;
  }

  const node = process.execPath;
  const cli = process.argv[1] ?? "";
  const logDir = join(homedir(), ".decku");
  await mkdir(logDir, { recursive: true });
  await mkdir(join(homedir(), "Library", "LaunchAgents"), { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${cli}</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join(logDir, "bridge.log")}</string>
  <key>StandardErrorPath</key><string>${join(logDir, "bridge.err.log")}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${process.env.PATH ?? "/usr/bin:/bin:/usr/local/bin"}</string></dict>
</dict>
</plist>
`;

  await writeFile(plistPath(), plist);
  spawnSync("launchctl", ["unload", plistPath()], { stdio: "ignore" });
  const r = spawnSync("launchctl", ["load", plistPath()], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error("launchctl load 실패:", r.stderr || r.error?.message);
    process.exitCode = 1;
    return;
  }
  console.log("✓ 자동 시작 등록됨 (로그인 시 자동 실행).");
  console.log("  로그:   ~/.decku/bridge.log");
  console.log("  해제:   decku uninstall");
}

export async function uninstall(): Promise<void> {
  if (notMac()) return;
  spawnSync("launchctl", ["unload", plistPath()], { stdio: "ignore" });
  await rm(plistPath(), { force: true });
  console.log("✓ 자동 시작 해제됨");
}
