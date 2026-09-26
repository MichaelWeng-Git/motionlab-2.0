// An environment variable set to the EMPTY STRING is not the same as an unset
// one, and the difference kills the build.
//
// next-auth's parseUrl does `new URL(url ?? defaultUrl)`. `??` only falls back
// on null/undefined, so "" goes straight into `new URL("")`, which throws
// TypeError: Invalid URL — and every page importing next-auth/react fails to
// prerender. The error names the page, never the variable, so it reads as a
// bug in the app.
//
// Vercel creates exactly this state: importing a project detects the names in
// .env.example and adds them with empty values. A first deploy then fails with
// a stack trace pointing at /login.
//
// Deleting them here, in the config that is evaluated before the build, turns
// an empty value back into "not set" — which every consumer already handles
// (next-auth falls back to localhost, sbBrowser() returns null, modelUrl()
// falls back to /models). A real value is still required for these to WORK;
// this only stops an empty one from being fatal.
for (const key of Object.keys(process.env)) {
  if (process.env[key] === "") delete process.env[key];
}

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
