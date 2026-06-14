import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The loader is an IIFE that runs at import time. It identifies its own <script> via
 * `document.currentScript`, reads `data-*` config off it, and injects an <iframe>.
 *
 * jsdom does not populate `document.currentScript` during a dynamic `import()`, so each
 * test stages a <script> in the DOM, points `document.currentScript` at it, then
 * `vi.resetModules()` + `await import("../loader")` re-runs the IIFE against that DOM.
 */

interface ScriptOptions {
  src?: string;
  dataset?: Record<string, string>;
}

function stageScript({ src = "https://api.example.com/widget.js", dataset = {} }: ScriptOptions = {}): HTMLScriptElement {
  const script = document.createElement("script");
  script.src = src;
  for (const [key, value] of Object.entries(dataset)) {
    script.dataset[key] = value;
  }
  document.body.appendChild(script);
  Object.defineProperty(document, "currentScript", {
    configurable: true,
    get: () => script,
  });
  return script;
}

async function runLoader(options?: ScriptOptions): Promise<HTMLScriptElement> {
  const script = stageScript(options);
  vi.resetModules();
  await import("../loader");
  return script;
}

function onlyIframe(): HTMLIFrameElement {
  const frames = document.querySelectorAll("iframe");
  expect(frames.length).toBe(1);
  return frames[0] as HTMLIFrameElement;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  // Remove the stubbed accessor so the next stage can redefine it.
  Reflect.deleteProperty(document, "currentScript");
  vi.restoreAllMocks();
});

describe("loader config → iframe src", () => {
  it("builds the iframe src from data-bot-name and data-primary-color as query params", async () => {
    await runLoader({
      src: "https://api.example.com/widget.js",
      dataset: { botName: "Aria", primaryColor: "#1d4ed8", mode: "bubble" },
    });

    const src = new URL(onlyIframe().src);
    expect(src.origin).toBe("https://api.example.com");
    expect(src.pathname).toBe("/widget");
    expect(src.searchParams.get("name")).toBe("Aria");
    expect(src.searchParams.get("color")).toBe("#1d4ed8");
  });

  it("honours data-api-url over the script origin and strips a trailing slash", async () => {
    await runLoader({
      src: "https://cdn.example.net/widget.js",
      dataset: { apiUrl: "https://bot.acme.com/", botName: "Helper", mode: "inline" },
    });

    expect(new URL(onlyIframe().src).origin).toBe("https://bot.acme.com");
  });

  it("falls back to the script origin and default name/color when no data-* are set", async () => {
    await runLoader({ src: "https://host.example.org/path/widget.js", dataset: { mode: "inline" } });

    const src = new URL(onlyIframe().src);
    expect(src.origin).toBe("https://host.example.org");
    expect(src.searchParams.get("name")).toBe("Assistant");
    expect(src.searchParams.get("color")).toBe("#1d4ed8");
  });

  it("does nothing when there is no currentScript", async () => {
    Object.defineProperty(document, "currentScript", { configurable: true, get: () => null });
    vi.resetModules();
    await import("../loader");
    expect(document.querySelectorAll("iframe").length).toBe(0);
  });
});

describe("iframe sandbox", () => {
  it("sandboxes the iframe with exactly the documented allow-list", async () => {
    await runLoader({ dataset: { mode: "inline" } });
    expect(onlyIframe().getAttribute("sandbox")).toBe(
      "allow-scripts allow-forms allow-same-origin",
    );
  });
});

describe("placement: inline vs bubble", () => {
  it("inline mode inserts a container before the script and adds no launcher button", async () => {
    const script = await runLoader({ dataset: { mode: "inline" } });

    // Container is inserted as the script's previous sibling.
    const container = script.previousElementSibling as HTMLElement | null;
    expect(container).not.toBeNull();
    expect(container!.querySelector("iframe")).not.toBeNull();
    // No floating launcher and nothing appended to <body> for inline.
    expect(document.querySelector("button")).toBeNull();
  });

  it("bubble mode (default) appends a launcher button and a hidden panel to body", async () => {
    await runLoader({ dataset: { botName: "Aria" } }); // mode omitted → bubble

    const button = document.querySelector("button");
    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-expanded")).toBe("false");
    expect(button!.getAttribute("aria-label")).toBe("Open Aria chat");

    // The panel containing the iframe starts hidden.
    const panel = onlyIframe().parentElement as HTMLElement;
    expect(panel.style.display).toBe("none");
  });

  it("bubble launcher toggles the panel open on click", async () => {
    await runLoader({ dataset: { botName: "Aria" } });
    const button = document.querySelector("button") as HTMLButtonElement;
    const panel = onlyIframe().parentElement as HTMLElement;

    button.click();
    expect(panel.style.display).toBe("block");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("Close Aria chat");
  });

  it("positions the bubble on the left when data-position=bottom-left", async () => {
    await runLoader({ dataset: { position: "bottom-left" } });
    const button = document.querySelector("button") as HTMLButtonElement;
    expect(button.style.left).toBe("20px");
    expect(button.style.right).toBe("");
  });

  it("defaults the bubble to the right side when no position is given", async () => {
    await runLoader({ dataset: {} });
    const button = document.querySelector("button") as HTMLButtonElement;
    expect(button.style.right).toBe("20px");
    expect(button.style.left).toBe("");
  });
});

describe("postMessage close handler", () => {
  function dispatchMessage(data: unknown, origin: string): void {
    window.dispatchEvent(new MessageEvent("message", { data, origin }));
  }

  it("closes the panel only for a close message from the widget origin", async () => {
    await runLoader({ src: "https://api.example.com/widget.js", dataset: { botName: "Aria" } });
    const button = document.querySelector("button") as HTMLButtonElement;
    const panel = onlyIframe().parentElement as HTMLElement;

    button.click(); // open it first
    expect(panel.style.display).toBe("block");

    dispatchMessage({ type: "rag-widget:close" }, "https://api.example.com");
    expect(panel.style.display).toBe("none");
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("ignores a close message from a foreign origin", async () => {
    await runLoader({ src: "https://api.example.com/widget.js", dataset: { botName: "Aria" } });
    const button = document.querySelector("button") as HTMLButtonElement;
    const panel = onlyIframe().parentElement as HTMLElement;

    button.click();
    dispatchMessage({ type: "rag-widget:close" }, "https://evil.example.com");
    expect(panel.style.display).toBe("block"); // still open — origin rejected
  });

  it("ignores an unrelated message type from the widget origin", async () => {
    await runLoader({ src: "https://api.example.com/widget.js", dataset: { botName: "Aria" } });
    const button = document.querySelector("button") as HTMLButtonElement;
    const panel = onlyIframe().parentElement as HTMLElement;

    button.click();
    dispatchMessage({ type: "something-else" }, "https://api.example.com");
    expect(panel.style.display).toBe("block"); // still open — wrong type
  });
});
