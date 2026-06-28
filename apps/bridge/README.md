# decku

[decku](https://github.com/) 로컬 브릿지 — 내 Mac의 Claude Desktop 세션을 웹앱에 **E2EE**로 연결한다. 세션 목록·대화를 암호화해 중계하고, 웹에서 친 채팅을 `claude --resume`으로 주입한다.

## 사용

```bash
# 1) 페어링 (웹앱 URL로) → QR/URL 출력
npx @decku/cli pair --url https://<your-decku>.vercel.app

# 2) 실행 (세션 watch + realtime)
npx @decku/cli run
```
출력된 QR/URL을 브라우저에서 열면 세션 목록·대화가 뜬다.

### 자동 시작 (macOS)
```bash
npm i -g @decku/cli
decku pair --url <webUrl>
decku install      # launchd 등록 (로그인 시 자동 실행)
decku uninstall    # 해제
```
로그: `~/.decku/bridge.log`. Windows=작업 스케줄러, Linux=systemd user에 `decku run`을 등록.

## 동작 / 보안

- `~/.claude/sessions`·`~/.claude/projects`(transcript)만 **읽는다**. 데스크탑 앱은 안 건드림.
- 모든 본문은 로컬 생성 `e2eeKey`(AES-256-GCM)로 암호화 → 중계 서버·벤더는 ciphertext만 본다.
- 페어링 정보·키는 `~/.decku/config.json`(0600)에만. 채팅 전송은 같은 sessionId를 `claude -p --resume`으로 이어받아 주입.
- 필요: Node ≥ 20, 로컬에 `claude` CLI(Claude Desktop이 설치).

> ⚠ decku 목록엔 **Desktop/interactive 세션**만 뜬다(`claude -p` 헤드리스 세션은 registry 미등록).
