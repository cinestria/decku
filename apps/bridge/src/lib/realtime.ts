/**
 * 브릿지 ↔ Supabase Realtime. 모든 페이로드는 E2EE 봉투로 암호화해 broadcast.
 *
 * 채널(전부 private):
 *   tenant:<ns>:sessions   세션 목록 (bridge → browser)
 *   tenant:<ns>:tx:<sid>   transcript (bridge → browser)
 *   tenant:<ns>:cmd        명령 (browser → bridge)  ← 여기만 수신
 * broadcast event 이름은 전부 "msg", payload = EncryptedEnvelope.
 */
import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";
import {
  importKey,
  encrypt,
  decrypt,
  decodeKey,
  sessionsChannel,
  txChannel,
  cmdChannel,
  type EncryptedEnvelope,
  type SessionsPayload,
  type TxPayload,
  type CmdPayload,
} from "@decku/shared";
import { apiRealtimeToken } from "./api.js";
import type { BridgeConfig } from "./config.js";

const REFRESH_MS = 50 * 60 * 1000; // realtime 토큰 1h 만료 전 갱신

export class BridgeRealtime {
  private supabase: SupabaseClient;
  private key!: CryptoKey;
  private sessionsCh!: RealtimeChannel;
  private txChs = new Map<string, RealtimeChannel>();
  private refreshTimer?: ReturnType<typeof setInterval>;

  constructor(private cfg: BridgeConfig) {
    this.supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async connect(onCmd: (cmd: CmdPayload) => void): Promise<void> {
    this.key = await importKey(decodeKey(this.cfg.e2eeKey));
    await this.refreshToken();
    this.refreshTimer = setInterval(() => {
      this.refreshToken().catch((e) => console.error("토큰 갱신 실패:", e));
    }, REFRESH_MS);

    this.sessionsCh = await this.joinPrivate(sessionsChannel(this.cfg.namespace));
    await this.joinPrivate(cmdChannel(this.cfg.namespace), (env) => {
      decrypt<CmdPayload>(this.key, env)
        .then(onCmd)
        .catch((e) => console.error("cmd 복호 실패:", e));
    });
  }

  private async refreshToken(): Promise<void> {
    const token = await apiRealtimeToken(this.cfg.apiUrl, this.cfg.pairingToken);
    await this.supabase.realtime.setAuth(token);
  }

  /** private 채널 구독. onMsg 있으면 수신용, 없으면 송신 전용. MissingPartition 일시 에러는 재시도. */
  private async joinPrivate(
    topic: string,
    onMsg?: (env: EncryptedEnvelope) => void,
    attempt = 0,
  ): Promise<RealtimeChannel> {
    try {
      return await new Promise<RealtimeChannel>((resolve, reject) => {
        const ch = this.supabase.channel(topic, {
          config: { private: true, broadcast: { self: false } },
        });
        if (onMsg) {
          ch.on("broadcast", { event: "msg" }, ({ payload }) =>
            onMsg(payload as EncryptedEnvelope),
          );
        }
        ch.subscribe((status, err) => {
          if (status === "SUBSCRIBED") resolve(ch);
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            this.supabase.removeChannel(ch);
            reject(err ?? new Error(status));
          }
        });
      });
    } catch (err) {
      // RLS 적용 직후 등 일시적 MissingPartition → 짧게 재시도
      if (attempt < 4) {
        await sleep(400 * (attempt + 1));
        return this.joinPrivate(topic, onMsg, attempt + 1);
      }
      throw err;
    }
  }

  async publishSessions(payload: SessionsPayload): Promise<void> {
    const env = await encrypt(this.key, payload);
    await this.sessionsCh.send({ type: "broadcast", event: "msg", payload: env });
  }

  async publishTx(payload: TxPayload): Promise<void> {
    let ch = this.txChs.get(payload.sessionId);
    if (!ch) {
      ch = await this.joinPrivate(txChannel(this.cfg.namespace, payload.sessionId));
      this.txChs.set(payload.sessionId, ch);
    }
    const env = await encrypt(this.key, payload);
    await ch.send({ type: "broadcast", event: "msg", payload: env });
  }

  async close(): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    await this.supabase.removeAllChannels();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
