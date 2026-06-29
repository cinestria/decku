/**
 * cmd 재전송(replay) 방어.
 *
 * cmd의 ts·nonce는 E2EE 봉투 *안*에 있어 위조 불가(GCM 인증). 공격자가 할 수 있는 건
 * 캡처한 봉투를 통째로 재전송하는 것뿐 → nonce 중복 + ts 윈도우로 차단한다.
 *
 *  - ts가 현재시각 기준 ±WINDOW_MS 밖이면 거부 (오래된 캡처).
 *  - 같은 nonce를 WINDOW_MS 안에서 또 보면 거부 (정확한 재전송).
 * 브라우저·브릿지 시계 차를 고려해 윈도우는 넉넉히(120s). 실제 방어는 nonce 중복.
 */
const WINDOW_MS = 120_000;

export class ReplayGuard {
  private seen = new Map<string, number>(); // nonce → ts(수신시각)

  /** 통과하면 true(기록함), replay/stale/누락이면 false. */
  check(nonce: string | undefined, ts: number | undefined, now = Date.now()): boolean {
    if (typeof ts !== "number" || typeof nonce !== "string" || nonce.length === 0) return false;
    if (Math.abs(now - ts) > WINDOW_MS) return false; // 너무 오래됨 → 재전송 의심
    if (this.seen.has(nonce)) return false; // 이미 본 nonce → 재전송
    this.seen.set(nonce, now);
    this.prune(now);
    return true;
  }

  private prune(now: number): void {
    for (const [n, t] of this.seen) {
      if (now - t > WINDOW_MS) this.seen.delete(n);
    }
  }
}
