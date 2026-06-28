/**
 * 토큰서버(웹앱) 호출.
 */
export interface PairResult {
  namespace: string;
  pairingToken: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export async function apiPair(apiUrl: string): Promise<PairResult> {
  const r = await fetch(`${apiUrl}/api/pair`, { method: "POST" });
  if (!r.ok) throw new Error(`/api/pair 실패: ${r.status} ${await r.text().catch(() => "")}`);
  return (await r.json()) as PairResult;
}

export async function apiRealtimeToken(apiUrl: string, pairingToken: string): Promise<string> {
  const r = await fetch(`${apiUrl}/api/realtime-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairingToken }),
  });
  if (!r.ok) throw new Error(`/api/realtime-token 실패: ${r.status}`);
  return ((await r.json()) as { token: string }).token;
}
