import { describe, expect, it } from "vitest";
import { computeRecovery, getRecoveryState, type MuscleState } from "@/lib/muscles";
import { intensityColor, qualityColor, SIGNAL } from "@/lib/palette";

const state = (over: Partial<MuscleState>): MuscleState => ({
  load: {}, fueled: 0, headline: "", measured: 0, unmeasured: 0, needsLength: 0, ...over,
});

describe("RecoveryState is the one answer every surface reads (P0-2)", () => {
  it("no training at all → empty", () => {
    expect(getRecoveryState(null).kind).toBe("empty");
    expect(getRecoveryState(state({})).kind).toBe("empty");
  });

  // Trained, but nothing the camera could measure. Saying "100% recovered"
  // here would claim the session did nothing — as false as over-crediting it.
  it("trained but unmeasurable → unmeasured, never a percentage", () => {
    const s = getRecoveryState(state({ measured: 0, unmeasured: 2 }));
    expect(s.kind).toBe("unmeasured");
    expect(s).not.toHaveProperty("pct");
  });

  it("measured with a real length → known", () => {
    const s = getRecoveryState(state({ measured: 1, load: { quads_l: 0.5 }, needsLength: 0 }));
    expect(s.kind).toBe("known");
    if (s.kind === "known") expect(s.pct).toBe(computeRecovery({ quads_l: 0.5 }));
  });

  // The assumption is allowed, but it has to travel with the number so every
  // surface can label it.
  it("measured on the 30-minute assumption → assumed-duration, with a count", () => {
    const s = getRecoveryState(state({ measured: 2, load: { quads_l: 0.5 }, needsLength: 2 }));
    expect(s.kind).toBe("assumed-duration");
    if (s.kind === "assumed-duration") expect(s.assumedWorkouts).toBe(2);
  });

  it("known and assumed-duration report the SAME percentage for the same load", () => {
    const load = { quads_l: 0.42, calves_r: 0.2 };
    const a = getRecoveryState(state({ measured: 1, load, needsLength: 0 }));
    const b = getRecoveryState(state({ measured: 1, load, needsLength: 1 }));
    expect(a.kind === "known" && b.kind === "assumed-duration").toBe(true);
    if (a.kind === "known" && b.kind === "assumed-duration") expect(a.pct).toBe(b.pct);
  });
});

describe("computeRecovery", () => {
  it("a clean body is fully recovered", () => {
    expect(computeRecovery({})).toBe(100);
    expect(computeRecovery(null)).toBe(100);
  });

  it("more load means less recovery", () => {
    expect(computeRecovery({ quads_l: 0.8 })).toBeLessThan(computeRecovery({ quads_l: 0.2 }));
  });

  it("one wrecked muscle still costs, even when the rest are clean", () => {
    expect(computeRecovery({ quads_l: 1 })).toBeLessThan(95);
  });

  it("stays inside 0-100", () => {
    const all = Object.fromEntries(
      ["quads_l","quads_r","hamstrings_l","hamstrings_r","glutes_l","glutes_r",
       "calves_l","calves_r","core","back","chest_l","chest_r",
       "shoulders_l","shoulders_r","arms_l","arms_r"].map((k) => [k, 1]),
    );
    const v = computeRecovery(all);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(100);
  });
});

describe("one colour scale (lib/palette)", () => {
  // A 73 rendered amber on one screen and green on another because four
  // divergent scales existed. The bands are the contract.
  it("73 is good, not a warning", () => {
    expect(qualityColor(73)).toBe(SIGNAL.good);
  });

  it("the amber band is the ~50 region", () => {
    expect(qualityColor(50)).toBe(SIGNAL.okay);
    expect(qualityColor(69)).toBe(SIGNAL.okay);
  });

  it("below 50 is work", () => {
    expect(qualityColor(47)).toBe(SIGNAL.work);
  });

  it("intensity runs the OTHER way — a full week is red, an easy one green", () => {
    expect(intensityColor(90)).toBe(SIGNAL.work);
    expect(intensityColor(10)).toBe(SIGNAL.good);
  });

  it("clamps outside 0-100 instead of throwing", () => {
    expect(qualityColor(-20)).toBe(SIGNAL.work);
    expect(qualityColor(180)).toBe(SIGNAL.good);
  });
});
