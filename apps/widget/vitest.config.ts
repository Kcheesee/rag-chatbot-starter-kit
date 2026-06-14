import { defineConfig } from "vitest/config";

// The loader is browser code: it reads its own <script> tag, injects an <iframe>,
// and wires a window "message" listener. jsdom gives us document/window/postMessage.
export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
