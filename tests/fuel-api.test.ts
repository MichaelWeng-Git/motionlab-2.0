import { describe, expect, it } from "vitest";
import { MAX_FUEL_REQUEST_BYTES, parseFuelModelOutput, readFuelBody } from "@/lib/fuel-api";

describe("fuel API trust boundary", () => {
  it("normalizes finite macro estimates into safe whole-number bounds", () => {
    expect(parseFuelModelOutput({
      isFood: true,
      dish: "  Chicken rice with extra chicken  ",
      protein: "42.6",
      carbs: 999,
      fat: -4,
      kcal: 9000,
      confidence: "medium",
    })).toEqual({
      isFood: true,
      dish: "Chicken rice with extra",
      protein: 43,
      carbs: 300,
      fat: 0,
      kcal: 5000,
      confidence: "medium",
    });
  });

  it.each([
    { isFood: "true", dish: "Meal", protein: 20, carbs: 30, fat: 10, kcal: 300, confidence: "high" },
    { isFood: true, dish: "Meal", protein: "unknown", carbs: 30, fat: 10, kcal: 300, confidence: "high" },
    { isFood: true, dish: "", protein: 20, carbs: 30, fat: 10, kcal: 300, confidence: "high" },
    { isFood: true, dish: "Meal", protein: 20, carbs: 30, fat: 10, kcal: 300, confidence: "certain" },
    { isFood: true, dish: "Meal", protein: 20, carbs: 30, fat: 10, kcal: 300, confidence: "high", extra: 1 },
  ])("rejects the whole estimate when any field is invalid", (value) => {
    expect(parseFuelModelOutput(value)).toBeNull();
  });

  it("accepts only a strict, bounded image request", () => {
    expect(readFuelBody({ image: "data:image/jpeg;base64,AAAA" })).toEqual({
      ok: true,
      image: "data:image/jpeg;base64,AAAA",
    });
  });

  // The guard rejects an oversized body before parsing (tests/api-guard); this is
  // the second wall, for an image that fits the body but not this route's ceiling.
  it("rejects an image past the fuel ceiling", () => {
    const huge = `data:image/jpeg;base64,${"A".repeat(MAX_FUEL_REQUEST_BYTES + 4)}`;
    expect(readFuelBody({ image: huge })).toEqual({
      ok: false,
      error: "invalid-request",
      status: 400,
    });
  });

  it("rejects malformed and extra request fields", () => {
    expect(readFuelBody({ image: "https://example.com/meal.jpg", userId: "someone-else" })).toEqual({
      ok: false,
      error: "invalid-request",
      status: 400,
    });
  });
});
