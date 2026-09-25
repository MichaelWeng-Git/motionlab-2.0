import { afterEach, describe, expect, it, vi } from "vitest";

// One resolver feeds 13 call sites across four pipeline files. If it silently
// keeps returning "/models/..." on a deploy that has no public/models, every
// analysis fails — with no build error to catch it.

const load = async (base?: string) => {
  vi.resetModules();
  if (base === undefined) delete process.env.NEXT_PUBLIC_MODEL_BASE;
  else process.env.NEXT_PUBLIC_MODEL_BASE = base;
  return import("@/lib/model-url");
};

afterEach(() => { delete process.env.NEXT_PUBLIC_MODEL_BASE; });

describe("modelUrl", () => {
  it("falls back to the app's own /models, so dev is unchanged", async () => {
    const m = await load();
    expect(m.modelUrl("yolov8s.onnx")).toBe("/models/yolov8s.onnx");
    expect(m.MODELS_ARE_REMOTE).toBe(false);
  });

  it("uses a configured base", async () => {
    const m = await load("https://cdn.example.com/v1");
    expect(m.modelUrl("yolov8s.onnx")).toBe("https://cdn.example.com/v1/yolov8s.onnx");
    expect(m.MODELS_ARE_REMOTE).toBe(true);
  });

  it("tolerates a trailing slash rather than producing a double one", async () => {
    const m = await load("https://cdn.example.com/v1///");
    expect(m.modelUrl("yolov8s.onnx")).toBe("https://cdn.example.com/v1/yolov8s.onnx");
  });

  it("treats an empty variable as unset", async () => {
    const m = await load("");
    expect(m.modelUrl("yolov8s.onnx")).toBe("/models/yolov8s.onnx");
  });
});
