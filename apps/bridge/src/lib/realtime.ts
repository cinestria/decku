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
  type HistoryPayload,
  type TxPayload,
  type CmdPayload,
} from "@decku/shared";
import { apiRealtimeToken } from "./api.js";
import type { BridgeConfig } from "./config.js";

const REFRESH_MS = 50 * 60 * 1000; // realtime 토큰 1h 만료 전 갱신
const HEALTH_MS = 15 * 1000; // 연결 상태 점검 주기 (끊겼으면 재구독)

export class BridgeRealtime {
  private supabase: SupabaseClient;
  private key!: CryptoKey;
  private sessionsCh?: RealtimeChannel;
  private cmdCh?: RealtimeChannel;
  private txChs = new Map<string, RealtimeChannel>();
  private refreshTimer?: ReturnType<typeof setInterval>;
  private watchdog?: ReturnType<typeof setInterval>;
  private healing = false;
  private onCmd?: (cmd: CmdPayload) => void;

  constructor(private cfg: BridgeConfig) {
    this.supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async connect(onCmd: (cmd: CmdPayload) => void): Promise<void> {
    this.onCmd = onCmd;
    this.key = await importKey(decodeKey(this.cfg.e2eeKey));
    await this.refreshToken();
    this.refreshTimer = setInterval(() => {
      this.refreshToken().catch((e) => console.error("토큰 갱신 실패:", e));
    }, REFRESH_MS);
    await this.subscribe();
    // 워치독: 채널이 끊겨 있으면(랩탑 sleep로 소켓 종료/토큰 만료 등) 토큰 갱신 후 재구독
    this.watchdog = setInterval(() => void this.ensureHealthy(), HEALTH_MS);
  }

  /** sessions + cmd 채널 구독 (재연결 시 재사용). */
  private async subscribe(): Promise<void> {
    this.sessionsCh = await this.joinPrivate(sessionsChannel(this.cfg.namespace));
    this.cmdCh = await this.joinPrivate(cmdChannel(this.cfg.namespace), (env) => {
      decrypt<CmdPayload>(this.key, env)
        .then((c) => this.onCmd?.(c))
        .catch((e) => console.error("cmd 복호 실패:", e));
    });
  }

  /** 끊긴 연결 자가복구: sessions 채널이 joined가 아니면 토큰 갱신 + 전체 재구독. */
  private async ensureHealthy(): Promise<void> {
    if (this.healing) return;
    // 확실히 끊긴 상태에서만 재연결 (joining/leaving 등 일시 상태엔 손대지 않음 → 불필요한 재구독·깜빡임 방지)
    const st = String(this.sessionsCh?.state);
    if (st !== "closed" && st !== "errored" && this.sessionsCh) return;
    this.healing = true;
    console.warn(`realtime 재연결 중… (sessions 상태: ${this.sessionsCh?.state})`);
    try {
      await this.refreshToken();
      await this.supabase.removeAllChannels();
      this.txChs.clear();
      await this.subscribe();
      console.log("realtime 재연결됨");
    } catch (e) {
      console.error("realtime 재연결 실패(다음 주기에 재시도):", (e as Error).message);
    } finally {
      this.healing = false;
    }
  }

  private async refreshToken(): Promise<void> {
    const token = await apiRealtimeToken(this.cfg.apiUrl, this.cfg.namespace, this.cfg.pairingToken);
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
    if (!this.sessionsCh) return; // 재연결 중
    const env = await encrypt(this.key, payload);
    await this.broadcast(this.sessionsCh, env);
  }

  async publishHistory(payload: HistoryPayload): Promise<void> {
    if (!this.sessionsCh) return;
    const env = await encrypt(this.key, payload);
    await this.broadcast(this.sessionsCh, env);
  }

  async publishTx(payload: TxPayload): Promise<void> {
    let ch = this.txChs.get(payload.sessionId);
    if (!ch) {
      ch = await this.joinPrivate(txChannel(this.cfg.namespace, payload.sessionId));
      this.txChs.set(payload.sessionId, ch);
    }
    const env = await encrypt(this.key, payload);
    await this.broadcast(ch, env);
  }

  /** REST broadcast로 명시 전송 (send()의 자동 REST 폴백 deprecation 경고 회피). */
  private async broadcast(ch: RealtimeChannel, env: EncryptedEnvelope): Promise<void> {
    const res = await ch.httpSend("msg", env);
    if (!res.success) console.error(`broadcast 실패 (${res.status}): ${res.error}`);
  }

  async close(): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    await this.supabase.removeAllChannels();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
