/**
 * `decku-bridge pair [--url <webUrl>]`
 *
 * 웹앱에서 namespace+pairingToken 받고, e2eeKey를 로컬 생성해 저장.
 * 브라우저에서 열 페어링 URL(+QR)을 출력. e2eeKey는 URL의 #fragment에만 → 서버로 안 감.
 */
import qrcode from "qrcode-terminal";
import { generateKeyBytes, encodeKey } from "@decku/shared";
import { apiPair } from "../lib/api.js";
import { saveConfig } from "../lib/config.js";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function pair(argv: string[]): Promise<void> {
  const apiUrl = (flag(argv, "--url") ?? process.env.DECKU_URL ?? "http://localhost:5173").replace(/\/$/, "");

  console.log(`페어링 중… (${apiUrl})`);
  const res = await apiPair(apiUrl);
  const e2eeKey = encodeKey(generateKeyBytes());

  await saveConfig({
    apiUrl,
    namespace: res.namespace,
    pairingToken: res.pairingToken,
    e2eeKey,
    supabaseUrl: res.supabaseUrl,
    supabaseAnonKey: res.supabaseAnonKey,
  });

  // e2eeKey/토큰은 #fragment → 브라우저만 보고 서버엔 전송 안 됨
  const frag = `ns=${res.namespace}&pt=${encodeURIComponent(res.pairingToken)}&k=${e2eeKey}`;
  const url = `${apiUrl}/#${frag}`;

  console.log(`\n✓ 페어링 저장됨 (namespace ${res.namespace.slice(0, 8)}…)\n`);
  console.log("브라우저에서 아래 QR을 스캔하거나 URL을 여세요:\n");
  qrcode.generate(url, { small: true });
  console.log(`\n  ${url}\n`);
  console.log("그다음 이 터미널에서:  decku-bridge run\n");
}
