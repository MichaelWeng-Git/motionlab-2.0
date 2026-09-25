"use client";

// The last resort: an error thrown by the root layout itself, where app/error.tsx
// cannot render because the layout that would host it is the thing that failed.
// It must ship its own <html>/<body>, and it cannot rely on the app's CSS being
// applied, so the few styles it needs are inline.

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#14181B", color: "#fff", fontFamily: "system-ui, -apple-system, sans-serif", padding: "0 32px" }}>
        <div style={{ maxWidth: 330, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>MotionLab could not start</h1>
          <p style={{ marginTop: 10, fontSize: 14, lineHeight: 1.4, color: "rgba(255,255,255,0.65)" }}>
            Your training is stored on this device and has not been touched.
          </p>
          <button
            onClick={reset}
            style={{ marginTop: 20, width: "100%", padding: "14px 0", borderRadius: 999, border: 0, background: "#fff", color: "#14181B", fontSize: 14, fontWeight: 800 }}
          >
            Try again
          </button>
          {error.digest && <p style={{ marginTop: 16, fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Reference {error.digest}</p>}
        </div>
      </body>
    </html>
  );
}
