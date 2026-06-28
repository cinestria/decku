import { defineConfig } from "tsup";

// @decku/shared(+zod)는 npm에 없으므로 번들에 인라인. supabase-js/qrcode-terminal은
// 런타임 dependency로 두고 external(설치 시 함께 깔림). → `npx @decku/bridge` 단일 동작.
export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  bundle: true,
  noExternal: ["@decku/shared"],
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
  minify: false,
});
