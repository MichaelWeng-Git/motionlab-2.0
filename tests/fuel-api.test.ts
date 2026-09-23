import { describe, expect, it } from "vitest";
import { MAX_FUEL_REQUEST_BYTES, parseFuelModelOutput, readFuelRequest } from "@/lib/fuel-api";

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

  it("accepts only a strict, bounded image request", async () => {
    const request = new Request("http://localhost/api/fuel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: "data:image/jpeg;base64,AAAA" }),
    });
    await expect(readFuelRequest(request)).resolves.toEqual({
      ok: true,
      image: "data:image/jpeg;base64,AAAA",
    });
  });

  it("rejects oversized bodies before reading them", async () => {
    const request = new Request("http://localhost/api/fuel", {
      method: "POST",
      headers: { "Content-Length": String(MAX_FUEL_REQUEST_BYTES + 1) },
      body: "{}",
    });
    await expect(readFuelRequest(request)).resolves.toEqual({
      ok: false,
      error: "payload-too-large",
      status: 413,
    });
  });

  it("rejects malformed and extra request fields", async () => {
    const request = new Request("http://localhost/api/fuel", {
      method: "POST",
      body: JSON.stringify({ image: "https://example.com/meal.jpg", userId: "someone-else" }),
    });
    await expect(readFuelRequest(request)).resolves.toEqual({
      ok: false,
      error: "invalid-request",
      status: 400,
    });
  });
});
