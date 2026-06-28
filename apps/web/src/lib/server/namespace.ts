/**
 * 테넌트 namespace 생성 — 추측 불가한 랜덤 식별자.
 * 계정 없이도 이게 격리 경계: 토큰이 이 namespace만 허용.
 */
export function newNamespace(): string {
  const bytes = new Uint8Array(18); // 144bit
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
