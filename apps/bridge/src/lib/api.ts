/**
 * 토큰서버(웹앱) 호출.
 */
export interface PairResult {
  namespace: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export async function apiPair(apiUrl: string): Promise<PairResult> {
  const r = await fetch(`${apiUrl}/api/pair`, { method: "POST" });
  if (!r.ok) throw new Error(`/api/pair 실패: ${r.status} ${await r.text().catch(() => "")}`);
  return (await r.json()) as PairResult;
}

export async function apiRealtimeToken(apiUrl: string, namespace: string): Promise<string> {
  const r = await fetch(`${apiUrl}/api/realtime-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ namespace }),
  });
  if (!r.ok) throw new Error(`/api/realtime-token 실패: ${r.status}`);
  return ((await r.json()) as { token: string }).token;
}
