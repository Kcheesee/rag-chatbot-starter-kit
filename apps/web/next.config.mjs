/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The workspace packages are shipped as TypeScript source (JIT packages), so Next
  // must transpile them.
  transpilePackages: [
    "@rag-chat-agent/rag-core",
    "@rag-chat-agent/ui-components",
    "@rag-chat-agent/llm-adapters",
    "@rag-chat-agent/vector-adapters",
    "@rag-chat-agent/ingestion",
    "@rag-chat-agent/audit-logger",
  ],

  experimental: {
    // Enable instrumentation.ts (stable in Next 15; experimental in 14.x) so we can
    // validate env at server startup.
    instrumentationHook: true,
    // Keep the provider SDKs as runtime externals — they're heavy, partly optional,
    // and only reached via lazy import inside the adapters. Bundling them is wasteful
    // and can break on native/optional bits.
    serverComponentsExternalPackages: [
      "ioredis",
      "pg",
      "@anthropic-ai/sdk",
      "@anthropic-ai/vertex-sdk",
      "openai",
      "@azure/identity",
      "google-auth-library",
      "@aws-sdk/client-bedrock-runtime",
      "@aws-sdk/client-comprehend",
      "@aws-sdk/client-cloudwatch-logs",
      "@aws-sdk/client-s3",
      "chromadb",
      "@pinecone-database/pinecone",
      "weaviate-client",
      "@notionhq/client",
      "mammoth",
      "pdf-parse",
      "cheerio",
    ],
  },
};

export default nextConfig;
