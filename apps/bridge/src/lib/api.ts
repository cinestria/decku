/**
 * 토큰서버(웹앱) 호출.
 */
export interface PairResult {
  namespace: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  pairingToken?: string; // expireDays 지정 시에만
}

export async function apiPair(apiUrl: string, expireDays?: number): Promise<PairResult> {
  const r = await fetch(`${apiUrl}/api/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(expireDays ? { expireDays } : {}),
  });
  if (!r.ok) throw new Error(`/api/pair 실패: ${r.status} ${await r.text().catch(() => "")}`);
  return (await r.json()) as PairResult;
}

/** pairingToken 있으면 그걸로(만료 검사), 없으면 namespace로(무제한). */
export async function apiRealtimeToken(
  apiUrl: string,
  namespace: string,
  pairingToken?: string,
): Promise<string> {
  const r = await fetch(`${apiUrl}/api/realtime-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(pairingToken ? { pairingToken } : { namespace }),
  });
  if (!r.ok) {
    if (r.status === 403) throw new Error("페어링 만료됨 — 'decku pair --new' 로 다시 페어링하세요");
    throw new Error(`/api/realtime-token 실패: ${r.status}`);
  }
  return ((await r.json()) as { token: string }).token;
}
