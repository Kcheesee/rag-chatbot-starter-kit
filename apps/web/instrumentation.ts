/**
 * Next.js instrumentation hook — runs once at server startup.
 *
 * We validate the environment here so a misconfigured deployment fails fast at boot
 * with a readable error, rather than 500-ing on the first request. `loadEnv` is the
 * single place process.env is parsed; calling it here primes (and memoises) it.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadEnv } = await import("@rag-chat-agent/rag-core/env");
    loadEnv();
  }
}
