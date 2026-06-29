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

function numFlag(argv: string[], name: string): number | undefined {
  const v = flag(argv, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** 새 namespace·키를 발급해 config로 저장하고 반환. (run의 자동 페어링도 이걸 씀)
 *  --expire-days N: 만료 페어링(opt-in). 미지정=무제한. */
export async function createPairing(argv: string[]): Promise<BridgeConfig> {
  const apiUrl = (flag(argv, "--url") ?? process.env.DECKU_URL ?? "https://decku.app").replace(/\/$/, "");
  const expireDays = numFlag(argv, "--expire-days");
  console.log(`페어링 중… (${apiUrl})${expireDays ? `, ${expireDays}일 후 만료` : ""}`);
  const res = await apiPair(apiUrl, expireDays);
  const cfg: BridgeConfig = {
    apiUrl,
    namespace: res.namespace,
    e2eeKey: encodeKey(generateKeyBytes()),
    supabaseUrl: res.supabaseUrl,
    supabaseAnonKey: res.supabaseAnonKey,
    ...(res.pairingToken ? { pairingToken: res.pairingToken } : {}),
  };
  await saveConfig(cfg);
  console.log(`✓ 새 페어링 저장됨 (namespace ${res.namespace.slice(0, 8)}…)${expireDays ? ` · ${expireDays}일 만료` : ""}`);
  return cfg;
}

/** 페어링 URL (만료 토큰 있으면 #fragment에 t= 포함 → 서버 미전송). */
export function pairUrl(cfg: BridgeConfig): string {
  const t = cfg.pairingToken ? `&t=${cfg.pairingToken}` : "";
  return `${cfg.apiUrl}/#ns=${cfg.namespace}&k=${cfg.e2eeKey}${t}`;
}

/** 페어링 QR + URL 출력. */
export function printPairing(cfg: BridgeConfig): void {
  const url = pairUrl(cfg);
  console.log("\n브라우저에서 아래 QR을 스캔하거나 URL을 여세요 (한 번만 열면 이후 자동 재연결):\n");
  qrcode.generate(url, { small: true });
  console.log(`\n  ${url}\n`);
}

export async function pair(argv: string[]): Promise<void> {
  const forceNew = argv.includes("--new") || argv.includes("--force");
  const existing = await loadConfig();

  let cfg: BridgeConfig;
  if (existing && !forceNew) {
    cfg = existing;
    console.log(`기존 페어링 재사용 (namespace ${cfg.namespace.slice(0, 8)}…). 새로 만들려면 --new.`);
  } else {
    cfg = await createPairing(argv);
  }

  printPairing(cfg);
  console.log("그다음:  decku   (watch + 중계 시작 — 또는 decku install 로 상시 실행)\n");
}
