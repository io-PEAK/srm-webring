// Vitest config for the Cloudflare Worker tests. Uses the
// @cloudflare/vitest-pool-workers pool with the backend
// wrangler.jsonc config so tests run in a real Workers runtime.
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
	test: {
		testTimeout: 30000,
		poolOptions: {
			workers: {
			wrangler: { configPath: "./wrangler.jsonc" },
			miniflare: {
				// Test-only bindings (never deployed — injected only by the
				// vitest pool). Mirrors the production LOOKUP_SECRET secret.
				bindings: { LOOKUP_SECRET: "test-secret" },
			},
			},
		},
	},
});
