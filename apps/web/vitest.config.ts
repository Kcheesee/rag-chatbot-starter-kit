import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Route handlers import their helpers via the Next.js "@/..." path alias
// (tsconfig: "@/*" -> "./*"). vitest doesn't read tsconfig paths, so mirror that
// single alias here. Node environment is correct for the API-route / lib tests.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
