import { describe, expect, it } from "vitest";
import { hasLocalTraining } from "@/lib/cloud-data";
import { deleteSession, getSessions, recordSession } from "@/lib/stats";

// This file guards the one failure this project keeps having: a code path that
// deletes an athlete's analyses. It has happened three times. Every test here
// describes a real incident or a near miss, not a hypothetical.

const clip = (id: string) => ({ id, date: "2026-09-09T10:20:00.000Z", sport: "Running" });

describe("hasLocalTraining — the guard on every destructive path", () => {
  it("is false on a genuinely empty device", () => {
    expect(hasLocalTraining()).toBe(false);
  });

  it("is false when the keys exist but hold empty arrays", () => {
    localStorage.setItem("ml_sessions", "[]");
    localStorage.setItem("ml_activities", "[]");
    expect(hasLocalTraining()).toBe(false);
  });

  it("sees analyses", () => {
    localStorage.setItem("ml_sessions", JSON.stringify([clip("s1")]));
    expect(hasLocalTraining()).toBe(true);
  });

  it("sees recorded activities", () => {
    localStorage.setItem("ml_activities", JSON.stringify([{ date: "x", seconds: 60 }]));
    expect(hasLocalTraining()).toBe(true);
  });

  // The primary key can be wiped by a bug while the mirror survives — that is
  // the entire reason the mirror exists, so it has to count as training.
  it("sees the backup mirror even when the primary is gone", () => {
    localStorage.setItem("ml_sessions_backup", JSON.stringify([clip("s1")]));
    expect(hasLocalTraining()).toBe(true);
  });

  it("survives corrupt JSON without throwing", () => {
    localStorage.setItem("ml_sessions", "{not json");
    expect(() => hasLocalTraining()).not.toThrow();
    expect(hasLocalTraining()).toBe(false);
  });
});

describe("session writes keep the mirror in step (P0-6)", () => {
  it("a recorded session lands in both the primary and the mirror", () => {
    recordSession({ sport: "Running", action: "Easy run", score: 70 } as never);
    expect(JSON.parse(localStorage.getItem("ml_sessions")!)).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("ml_sessions_backup")!)).toHaveLength(1);
  });

  // The bug: deleteSession wrote the primary only, so the next read restored
  // the deleted session from the mirror and it came back from the dead.
  it("a deleted session does not come back from the mirror", () => {
    const id = recordSession({ sport: "Running", action: "Easy run", score: 70 } as never);
    deleteSession(id);
    localStorage.removeItem("ml_sessions");   // force the restore path
    expect(getSessions()).toHaveLength(0);
  });

  it("restores from the mirror when the primary is lost", () => {
    recordSession({ sport: "Tennis", action: "Serve", score: 80 } as never);
    localStorage.removeItem("ml_sessions");
    expect(getSessions()).toHaveLength(1);
    // and having restored it, the primary is rewritten
    expect(localStorage.getItem("ml_sessions")).toBeTruthy();
  });
});
