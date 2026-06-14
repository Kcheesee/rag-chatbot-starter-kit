import { defineConfig } from "vitest/config";

// Component tests need a DOM. Each test file imports "@testing-library/jest-dom/vitest"
// to register the accessibility matchers (toBeInTheDocument, toHaveAttribute, ...).
export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
