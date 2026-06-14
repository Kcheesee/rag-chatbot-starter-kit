/**
 * Embeddable widget loader — built to a single `widget.js` (esbuild IIFE).
 *
 * A host page drops in one script tag:
 *
 *   <script src="https://your-api.com/widget.js"
 *           data-api-url="https://your-api.com"
 *           data-bot-name="Aria"
 *           data-primary-color="#1d4ed8"
 *           data-position="bottom-right"
 *           data-mode="bubble"></script>
 *
 * The chat UI runs inside a sandboxed <iframe> served by the API at `/widget`, so it
 * cannot read or pollute the host page's DOM/cookies. The iframe is same-origin with
 * the API (no CORS); which host pages may embed it is enforced server-side via a CSP
 * `frame-ancestors` header keyed off WIDGET_ALLOWED_ORIGINS.
 */

(function initWidget(): void {
  const script = document.currentScript as HTMLScriptElement | null;
  if (!script) return; // requires a synchronous <script> include (document.currentScript)

  const data = script.dataset;
  const apiUrl = (data.apiUrl ?? new URL(script.src).origin).replace(/\/$/, "");
  const botName = data.botName ?? "Assistant";
  const color = data.primaryColor ?? "#1d4ed8";
  const position = data.position === "bottom-left" ? "bottom-left" : "bottom-right";
  const mode = data.mode === "inline" ? "inline" : "bubble";
  const widgetOrigin = new URL(apiUrl).origin;

  const iframeSrc = `${apiUrl}/widget?${new URLSearchParams({ name: botName, color }).toString()}`;

  function buildIframe(): HTMLIFrameElement {
    const iframe = document.createElement("iframe");
    iframe.src = iframeSrc;
    iframe.title = `${botName} chat`;
    // Sandboxed: scripts + forms run, same-origin (to talk to its own API), but it
    // cannot reach the host page.
    iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-same-origin");
    iframe.style.cssText = "border:0;width:100%;height:100%;display:block;";
    return iframe;
  }

  // Inline mode: render in place of the script tag, filling its container.
  if (mode === "inline") {
    const container = document.createElement("div");
    container.style.cssText = "width:100%;height:600px;max-height:80vh;";
    container.appendChild(buildIframe());
    script.parentNode?.insertBefore(container, script);
    return;
  }

  // Bubble mode: a floating launcher that toggles a panel containing the iframe.
  const side = position === "bottom-left" ? "left:20px;" : "right:20px;";

  const panel = document.createElement("div");
  panel.style.cssText =
    `position:fixed;bottom:88px;${side}width:380px;max-width:calc(100vw - 40px);` +
    `height:560px;max-height:calc(100vh - 120px);background:#fff;border-radius:14px;` +
    `overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.18);display:none;z-index:2147483646;`;
  panel.appendChild(buildIframe());

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "💬";
  button.setAttribute("aria-label", `Open ${botName} chat`);
  button.setAttribute("aria-expanded", "false");
  button.style.cssText =
    `position:fixed;bottom:20px;${side}width:56px;height:56px;border-radius:50%;border:0;` +
    `background:${color};color:#fff;font-size:24px;line-height:1;cursor:pointer;` +
    `box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:2147483647;`;

  let open = false;
  function setOpen(next: boolean): void {
    open = next;
    panel.style.display = open ? "block" : "none";
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute("aria-label", `${open ? "Close" : "Open"} ${botName} chat`);
  }

  button.addEventListener("click", () => setOpen(!open));

  // The iframe can ask to close itself; only trust messages from the widget origin.
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.origin !== widgetOrigin) return;
    const payload = event.data as { type?: string } | null;
    if (payload?.type === "rag-widget:close") setOpen(false);
  });

  document.body.appendChild(button);
  document.body.appendChild(panel);
})();
