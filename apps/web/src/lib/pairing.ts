/**
 * 페어링 정보 = { ns, pt, k }. 브릿지 QR URL의 #fragment로 들어옴 (서버 미전송).
 * 한 번 받으면 localStorage에 저장하고 주소창 hash는 지운다(시크릿 숨김).
 * e2eeKey(k)는 절대 서버로 안 나감.
 */
export interface Pairing {
  ns: string; // namespace
  pt: string; // pairing token
  k: string; // e2ee key (base64url)
}

const STORE_KEY = "decku.pairing";

export function loadPairing(): Pairing | null {
  if (typeof window === "undefined") return null;

  if (location.hash.length > 1) {
    const h = new URLSearchParams(location.hash.slice(1));
    const ns = h.get("ns");
    const pt = h.get("pt");
    const k = h.get("k");
    if (ns && pt && k) {
      const p: Pairing = { ns, pt, k };
      localStorage.setItem(STORE_KEY, JSON.stringify(p));
      history.replaceState(null, "", location.pathname + location.search);
      return p;
    }
  }

  const stored = localStorage.getItem(STORE_KEY);
  return stored ? (JSON.parse(stored) as Pairing) : null;
}

export function clearPairing(): void {
  localStorage.removeItem(STORE_KEY);
}

/** 스캔한 QR 텍스트(페어링 URL)에서 ns/pt/k 파싱해 저장. 성공 시 true. */
export function savePairingFromUrl(text: string): boolean {
  try {
    const u = new URL(text);
    const h = new URLSearchParams(u.hash.slice(1));
    const ns = h.get("ns");
    const pt = h.get("pt");
    const k = h.get("k");
    if (ns && pt && k) {
      localStorage.setItem(STORE_KEY, JSON.stringify({ ns, pt, k }));
      return true;
    }
  } catch {
    /* invalid */
  }
  return false;
}
