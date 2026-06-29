/**
 * 브라우저 ↔ Supabase Realtime. 브릿지가 보낸 암호화 페이로드를 복호해 콜백으로 넘김.
 * cmd는 암호화해 publish (load 요청 등).
 */
import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";
import { env } from "$env/dynamic/public";
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
  type SessionListItem,
  type ImageAttachment,
} from "@decku/shared";
import type { Pairing } from "./pairing";

const REFRESH_MS = 45 * 60 * 1000; // realtime 토큰 1h 만료 전 갱신 → 오래 열어둬도 안 끊김

export class DeckuClient {
  private sb: SupabaseClient;
  private key!: CryptoKey;
  private cmdCh?: RealtimeChannel;
  private txCh?: RealtimeChannel;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private watchTimer?: ReturnType<typeof setInterval>;

  constructor(private p: Pairing) {
    const url = env.PUBLIC_SUPABASE_URL;
    const anon = env.PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      throw new Error("PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY 미설정 (Vercel env)");
    }
    this.sb = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async start(handlers: {
    onSessions: (items: SessionListItem[]) => void;
    onHistory?: (items: SessionListItem[]) => void;
  }): Promise<void> {
    this.key = await importKey(decodeKey(this.p.k));
    await this.refresh();
    this.refreshTimer = setInterval(() => {
      void this.refresh().catch((e) => console.error("토큰 갱신 실패:", e));
    }, REFRESH_MS);
    const sessionsCh = await this.join(sessionsChannel(this.p.ns), async (env) => {
      const payload = await decrypt<SessionsPayload | HistoryPayload>(this.key, env);
      if (payload.type === "sessions") handlers.onSessions(payload.items);
      else if (payload.type === "history") handlers.onHistory?.(payload.items);
    });
    // presence 등록 → 브릿지가 "보는 사람 있음"을 알고 그때만 heartbeat 전송
    await sessionsCh.track({ at: Date.now() });
    this.cmdCh = await this.join(cmdChannel(this.p.ns)); // 송신용
    // watch keepalive(presence 폴백) — 보는 동안 30s마다 신호
    await this.sendCmd({ op: "watch" });
    this.watchTimer = setInterval(() => {
      void this.sendCmd({ op: "watch" }).catch(() => {});
    }, 30_000);
  }

  /** 과거 세션 기록 요청 (브릿지가 history 채널로 응답). */
  async requestHistory(limit = 40): Promise<void> {
    await this.sendCmd({ op: "history", limit });
  }

  /** 세션 열기: 그 tx 채널 구독 + 백필 요청. onTx로 복호된 페이로드 전달. */
  async openSession(sid: string, onTx: (payload: TxPayload) => void): Promise<void> {
    if (this.txCh) {
      await this.sb.removeChannel(this.txCh);
      this.txCh = undefined;
    }
    this.txCh = await this.join(txChannel(this.p.ns, sid), async (env) => {
      const payload = await decrypt<TxPayload>(this.key, env);
      if (payload.type === "tx" && payload.sessionId === sid) onTx(payload);
    });
    await this.sendCmd({ op: "load", sessionId: sid });
  }

  /** 채팅 전송: 브릿지가 claude --resume로 주입. 이미지 첨부 가능. */
  async sendChat(sessionId: string, text: string, images?: ImageAttachment[]): Promise<void> {
    // ts·nonce: 브릿지 재전송 방어용 (E2EE 봉투 안에 들어감)
    await this.sendCmd({
      op: "send",
      sessionId,
      text,
      ...(images?.length ? { images } : {}),
      ts: Date.now(),
      nonce: crypto.randomUUID(),
    });
  }

  private async sendCmd(cmd: CmdPayload): Promise<void> {
    if (!this.cmdCh) throw new Error("cmd 채널 미연결");
    const env = await encrypt(this.key, cmd);
    await this.cmdCh.send({ type: "broadcast", event: "msg", payload: env });
  }

  private async refresh(): Promise<void> {
    const r = await fetch("/api/realtime-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // 만료 토큰 있으면 그걸로(만료 검사), 없으면 namespace로(무제한)
      body: JSON.stringify(this.p.t ? { pairingToken: this.p.t } : { namespace: this.p.ns }),
    });
    if (!r.ok) throw new Error(r.status === 403 ? "페어링 만료됨 — 다시 페어링하세요" : `realtime-token ${r.status}`);
    const { token } = (await r.json()) as { token: string };
    await this.sb.realtime.setAuth(token);
  }

  private async join(
    topic: string,
    onMsg?: (env: EncryptedEnvelope) => void | Promise<void>,
    attempt = 0,
  ): Promise<RealtimeChannel> {
    try {
      return await new Promise<RealtimeChannel>((resolve, reject) => {
        const ch = this.sb.channel(topic, { config: { private: true, broadcast: { self: false } } });
        if (onMsg) {
          ch.on("broadcast", { event: "msg" }, ({ payload }) => {
            void onMsg(payload as EncryptedEnvelope);
          });
        }
        ch.subscribe((status, err) => {
          if (status === "SUBSCRIBED") resolve(ch);
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            this.sb.removeChannel(ch);
            reject(err ?? new Error(status));
          }
        });
      });
    } catch (err) {
      if (attempt < 4) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        return this.join(topic, onMsg, attempt + 1);
      }
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.watchTimer) clearInterval(this.watchTimer);
    await this.sb.removeAllChannels();
  }
}
