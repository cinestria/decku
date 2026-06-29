import { z } from "zod";
import { SessionListItemSchema } from "./sessions.js";

/**
 * Realtime 채널 위로 흐르는 메시지 포맷.
 *
 * 모든 본문은 E2EE 봉투(EncryptedEnvelope)로 감싸 publish한다 → Supabase/서버는
 * ciphertext만 본다. 아래 *Payload 들은 봉투 안에 들어가는 "복호된 평문" 스키마.
 */

/** E2EE 봉투. 채널 위로 실제 전송되는 바깥 형태. */
export const EncryptedEnvelopeSchema = z.object({
  v: z.literal(1),
  alg: z.literal("AES-GCM"),
  iv: z.string(), // base64 (12-byte nonce)
  ct: z.string(), // base64 ciphertext (+ GCM tag)
});
export type EncryptedEnvelope = z.infer<typeof EncryptedEnvelopeSchema>;

// --- 복호 후 평문 payload들 ---

/** 렌더 이벤트 (transcript.ts의 RenderEvent를 wire에서 검증). */
const ContentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("thinking"), text: z.string() }),
  z.object({ type: z.literal("tool_use"), name: z.string(), id: z.string().optional() }),
  z.object({ type: z.literal("tool_result"), text: z.string() }),
  z.object({ type: z.literal("image") }),
  z.object({ type: z.literal("unknown"), raw: z.string() }),
]);

const RenderEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("message"),
    role: z.enum(["user", "assistant"]),
    blocks: z.array(ContentBlockSchema),
    uuid: z.string().optional(),
    timestamp: z.string().optional(),
  }),
  z.object({
    kind: z.literal("title"),
    title: z.string(),
    sessionId: z.string().optional(),
  }),
]);

/** sessions 채널: 브릿지 → 브라우저, 현재 live 세션 목록. */
export const SessionsPayloadSchema = z.object({
  type: z.literal("sessions"),
  items: z.array(SessionListItemSchema),
});
export type SessionsPayload = z.infer<typeof SessionsPayloadSchema>;

/** sessions 채널: 브릿지 → 브라우저, 과거 세션 기록(on-demand, 최근순). */
export const HistoryPayloadSchema = z.object({
  type: z.literal("history"),
  items: z.array(SessionListItemSchema),
});
export type HistoryPayload = z.infer<typeof HistoryPayloadSchema>;

/** 첨부 이미지 (base64). */
export const ImageAttachmentSchema = z.object({
  mediaType: z.string(), // image/png 등
  dataBase64: z.string(),
});
export type ImageAttachment = z.infer<typeof ImageAttachmentSchema>;

/**
 * tx:<sessionId> 채널: 브릿지 → 브라우저, transcript 이벤트.
 * - 실시간 append: events 한두 개, seq/done 생략.
 * - on-demand backfill: 큰 jsonl 을 청크로 쪼개 seq 증가, 마지막에 done=true.
 */
export const TxPayloadSchema = z.object({
  type: z.literal("tx"),
  sessionId: z.string(),
  events: z.array(RenderEventSchema),
  seq: z.number().optional(),
  done: z.boolean().optional(),
});
export type TxPayload = z.infer<typeof TxPayloadSchema>;

/** cmd 채널: 브라우저 → 브릿지. */
export const CmdPayloadSchema = z.discriminatedUnion("op", [
  // 세션 transcript backfill 요청
  z.object({ op: z.literal("load"), sessionId: z.string() }),
  // 채팅 전송 (resume 로 주입). 이미지 첨부 가능.
  // ts·nonce: 재전송(replay) 방어 — 브릿지가 오래된/중복 cmd를 거부 (E2EE 봉투 안이라 위조 불가).
  z.object({
    op: z.literal("send"),
    sessionId: z.string(),
    text: z.string(),
    images: z.array(ImageAttachmentSchema).optional(),
    ts: z.number().optional(),
    nonce: z.string().optional(),
  }),
  // 과거 세션 기록 요청
  z.object({ op: z.literal("history"), limit: z.number().optional() }),
  // 시청 중 신호(keepalive) — 브릿지가 "보는 사람 있음" 판정 (presence 폴백)
  z.object({ op: z.literal("watch") }),
]);
export type CmdPayload = z.infer<typeof CmdPayloadSchema>;
