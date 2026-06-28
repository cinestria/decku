import adapter from "@sveltejs/adapter-vercel";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // 런타임 명시 — 로컬 Node 버전과 무관하게 Vercel에서 nodejs22.x 사용
    adapter: adapter({ runtime: "nodejs22.x" }),
  },
};

export default config;
