/**
 * `decku pair [--url <webUrl>] [--new]`
 *
 * 멱등: 이미 페어링돼 있으면 **같은 namespace/키를 재사용**하고 링크만 다시 보여준다.
 *       → 브릿지를 재시작해도 브라우저에 저장된 페어링이 그대로 유효(연속성).
 *       새 namespace로 갈아끼우려면 `--new`.
 *
 * e2eeKey/토큰은 URL의 #fragment에만 → 서버로 안 감.
 */
import qrcode from "qrcode-terminal";
import { generateKeyBytes, encodeKey } from "@decku/shared";
import { apiPair } from "../lib/api.js";
import { loadConfig, saveConfig, type BridgeConfig } from "../lib/config.js";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function pair(argv: string[]): Promise<void> {
  const forceNew = argv.includes("--new") || argv.includes("--force");
  const existing = await loadConfig();

  let cfg: BridgeConfig;
  if (existing && !forceNew) {
    cfg = existing;
    console.log(`기존 페어링 재사용 (namespace ${cfg.namespace.slice(0, 8)}…). 새로 만들려면 --new.`);
  } else {
    const apiUrl = (flag(argv, "--url") ?? process.env.DECKU_URL ?? "https://decku.vercel.app").replace(/\/$/, "");
    console.log(`페어링 중… (${apiUrl})`);
    const res = await apiPair(apiUrl);
    cfg = {
      apiUrl,
      namespace: res.namespace,
      pairingToken: res.pairingToken,
      e2eeKey: encodeKey(generateKeyBytes()),
      supabaseUrl: res.supabaseUrl,
      supabaseAnonKey: res.supabaseAnonKey,
    };
    await saveConfig(cfg);
    console.log(`✓ 새 페어링 저장됨 (namespace ${res.namespace.slice(0, 8)}…)`);
  }

  const frag = `ns=${cfg.namespace}&pt=${encodeURIComponent(cfg.pairingToken)}&k=${cfg.e2eeKey}`;
  const url = `${cfg.apiUrl}/#${frag}`;

  console.log("\n브라우저에서 아래 QR을 스캔하거나 URL을 여세요 (한 번만 열면 이후 자동 재연결):\n");
  qrcode.generate(url, { small: true });
  console.log(`\n  ${url}\n`);
  console.log("그다음:  decku run   (또는 decku install 로 상시 실행)\n");
}
