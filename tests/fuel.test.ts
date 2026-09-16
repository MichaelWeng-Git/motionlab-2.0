import { describe, expect, it } from "vitest";
import { proteinTargetForWeight, TRAINING_PROTEIN_G_PER_KG } from "@/lib/fuel";

describe("protein target", () => {
  it("uses the documented training factor", () => {
    expect(TRAINING_PROTEIN_G_PER_KG).toBe(1.6);
    expect(proteinTargetForWeight(70)).toBe(112);
  });

  it("never invents a target without a valid body weight", () => {
    expect(proteinTargetForWeight(undefined)).toBeNull();
    expect(proteinTargetForWeight(0)).toBeNull();
    expect(proteinTargetForWeight(Number.NaN)).toBeNull();
  });
});
