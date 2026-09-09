"use client";

// Shared onnxruntime-web loader for all on-device models.
//
// Loaded from /public/ort via a NATIVE dynamic import (webpackIgnore) — NOT through
// the bundler. Reason: webpack rewrites the library's import.meta.url to a file://
// path, so its worker spawning breaks ("SecurityError: Failed to construct Worker").
// Served same-origin, import.meta.url is an http URL and workers just work.
//
//  · Picks the right build: ort.webgpu.bundle when the browser has WebGPU
//    (the plain build silently lacks that backend), plain bundle otherwise.
//  · Multi-threaded WASM when the page is cross-origin isolated; if threaded init
//    fails, retries single-threaded.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ort = any;

let cached: Promise<{ ort: Ort; hasWebGPU: boolean }> | null = null;

function loadOrt() {
  if (!cached) {
    cached = (async () => {
      const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
      const url = hasWebGPU ? "/ort/ort.webgpu.bundle.min.mjs" : "/ort/ort.bundle.min.mjs";
      const ort: Ort = await import(/* webpackIgnore: true */ url);
      ort.env.wasm.wasmPaths = "/ort/";
      ort.env.wasm.numThreads =
        typeof crossOriginIsolated !== "undefined" && crossOriginIsolated
          ? Math.min(4, navigator.hardwareConcurrency || 1)
          : 1;
      return { ort, hasWebGPU };
    })();
  }
  return cached;
}

export async function createOrtSession(modelPath: string, opts2?: { forceWasm?: boolean }) {
  const { ort, hasWebGPU } = await loadOrt();
  // forceWasm: some graphs hit WebGPU kernel gaps (e.g. YOLOv8's DFL Softmax on a
  // non-last axis) that only surface at RUN time — those models must pin to WASM
  const useGpu = hasWebGPU && !opts2?.forceWasm;
  const opts = {
    executionProviders: useGpu ? ["webgpu", "wasm"] : ["wasm"],
    graphOptimizationLevel: "all" as const,
  };
  let session;
  try {
    session = await ort.InferenceSession.create(modelPath, opts);
  } catch {
    // threaded WASM can fail to spawn its workers in some setups — retry on 1 thread
    ort.env.wasm.numThreads = 1;
    session = await ort.InferenceSession.create(modelPath, opts);
  }
  return { ort, hasWebGPU, session };
}
