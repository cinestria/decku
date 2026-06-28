/**
 * 브릿지 로컬 설정 — `~/.decku/config.json` (페어링 결과 보관).
 * e2eeKey 포함 → 권한 0600, 절대 커밋/전송 금지.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export interface BridgeConfig {
  apiUrl: string; // 웹앱 base URL (예: https://decku.vercel.app)
  namespace: string; // 자격증명 (랜덤)
  e2eeKey: string; // base64url (32B)
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export const DECKU_DIR = join(homedir(), ".decku");
export const CONFIG_FILE = join(DECKU_DIR, "config.json");

export async function loadConfig(): Promise<BridgeConfig | null> {
  try {
    return JSON.parse(await readFile(CONFIG_FILE, "utf8")) as BridgeConfig;
  } catch {
    return null;
  }
}

export async function saveConfig(c: BridgeConfig): Promise<void> {
  await mkdir(DECKU_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(c, null, 2), { mode: 0o600 });
}
