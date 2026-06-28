import { defineConfig } from "vitest/config";

// SvelteKit 플러그인 없이 순수 단위 테스트 (서버 lib 등). $env 의존 모듈은 테스트 대상에서 제외.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
