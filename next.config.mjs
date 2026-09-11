/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep the live dev server isolated from `next build`. Both commands use
  // `.next` by default, so running a production verification while localhost
  // is open can replace its CSS/JS chunks and leave the browser with unstyled
  // HTML until the server is restarted.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  webpack: (config, { isServer }) => {
    // onnxruntime-web references Node built-ins it doesn't use in the browser
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, crypto: false };
    if (isServer) {
      // the webgpu bundle is browser-only (its exports map blocks Node) — stub it out
      // of the SSR build; the dynamic import only ever runs client-side anyway
      config.resolve.alias = {
        ...config.resolve.alias,
        "onnxruntime-web/webgpu": false,
        "onnxruntime-web": false,
      };
    }
    return config;
  },
  // Cross-origin isolation unlocks MULTI-THREADED WASM for the AI models (3-4× faster
  // pose refinement). "credentialless" keeps external no-cors loads (map tiles) working;
  // browsers that don't support it just ignore the header and fall back to 1 thread.
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
      ],
    },
  ],
};

export default nextConfig;
