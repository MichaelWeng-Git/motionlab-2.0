import { describe, expect, it } from "vitest";
import { buildWorkouts, workoutMuscleLoad, readBody } from "@/lib/workouts";
import { dayKey } from "@/lib/date";

// The five acceptance cases from docs/P0-1-workout-model.md §6, plus the
// timezone boundary from P0-5. These pin the shape of the record, not the
// constants — a test that hard-codes REF_SESSION_SCALE proves nothing.

const DEMAND = { quads_l: 400, quads_r: 380, calves_l: 300, hamstrings_l: 200 };

const clip = (id: string, date: string, sport = "Running", action = "Easy run") => ({
  id, date, sport, action,
  report: { duration: 6.5, biomech: { demandRaw: DEMAND, observedS: 6.5, weightKg: 70 } },
});
const recording = (date: string, sport: string, seconds: number) => ({ date, sport, seconds });

function seed(sessions: unknown[], activities: unknown[] = [], profile = { height: 172, weight: 70 }) {
  localStorage.setItem("ml_sessions", JSON.stringify(sessions));
  localStorage.setItem("ml_activities", JSON.stringify(activities));
  localStorage.setItem("ml_profile", JSON.stringify(profile));
}

const doseOf = (w: ReturnType<typeof buildWorkouts>[number]) => {
  const ml = workoutMuscleLoad(w, readBody());
  if (!ml) return null;
  const worked = Object.values(ml).filter((v) => v > 0.05);
  return worked.length ? worked.reduce((a, b) => a + b, 0) / worked.length : 0;
};

describe("one training counts once (P0-1)", () => {
  // Filming a clip during a recorded run used to produce two records that LOAD
  // added to the same day, the second using the very duration that had already
  // scaled the first.
  it("a clip filmed during a recording is ONE workout", () => {
    seed(
      [clip("s1", "2026-09-09T10:20:00.000Z")],
      [recording("2026-09-09T10:45:00.000Z", "Running", 45 * 60)],
    );
    const w = buildWorkouts();
    expect(w).toHaveLength(1);
    expect(w[0].clips).toHaveLength(1);
    expect(w[0].recording).toBeTruthy();
  });

  it("takes its duration from the recording", () => {
    seed(
      [clip("s1", "2026-09-09T10:20:00.000Z")],
      [recording("2026-09-09T10:45:00.000Z", "Running", 45 * 60)],
    );
    expect(buildWorkouts()[0].durationSource).toBe("recorded");
    expect(buildWorkouts()[0].durationS).toBe(2700);
  });

  // The athlete is the authority on how long they trained: a 45-minute GPS
  // track can cover a session they only worked 30 minutes of.
  it("a stated length beats the recording", () => {
    const c = { ...clip("s1", "2026-09-09T10:20:00.000Z"), sessionSeconds: 30 * 60 };
    seed([c], [recording("2026-09-09T10:45:00.000Z", "Running", 45 * 60)]);
    const w = buildWorkouts()[0];
    expect(w.durationSource).toBe("stated");
    expect(w.durationS).toBe(1800);
  });

  it("several clips of one session collapse into one workout", () => {
    seed([
      clip("s1", "2026-09-09T10:20:00.000Z"),
      clip("s2", "2026-09-09T10:25:00.000Z"),
      clip("s3", "2026-09-09T10:31:00.000Z"),
    ]);
    const w = buildWorkouts();
    expect(w).toHaveLength(1);
    expect(w[0].clips).toHaveLength(3);
  });

  it("different sports on the same day stay separate", () => {
    seed([
      clip("s1", "2026-09-09T10:20:00.000Z", "Running", "Easy run"),
      clip("s2", "2026-09-09T10:40:00.000Z", "Tennis", "Serve"),
    ]);
    expect(buildWorkouts()).toHaveLength(2);
  });

  it("a recording with no clips is still a workout", () => {
    seed([], [recording("2026-09-05T18:00:00.000Z", "Cycling", 60 * 60)]);
    const w = buildWorkouts();
    expect(w).toHaveLength(1);
    expect(w[0].clips).toHaveLength(0);
    expect(w[0].durationSource).toBe("recorded");
  });

  // A recording carries duration and distance. It must never produce a muscle
  // map — nothing in this app estimates muscles from a sport name.
  it("a recording alone produces no muscle load", () => {
    seed([], [recording("2026-09-05T18:00:00.000Z", "Cycling", 60 * 60)]);
    expect(workoutMuscleLoad(buildWorkouts()[0], readBody())).toBeNull();
  });

  it("without a body, muscle load is withheld rather than guessed", () => {
    seed([clip("s1", "2026-09-09T10:20:00.000Z")], [], {} as never);
    const ml = workoutMuscleLoad(buildWorkouts()[0], readBody());
    expect(ml === null || Object.keys(ml).length === 0).toBe(true);
  });

  it("a longer session is a bigger dose than a shorter one", () => {
    seed([{ ...clip("s1", "2026-09-09T10:20:00.000Z"), sessionSeconds: 20 * 60 }]);
    const short = doseOf(buildWorkouts()[0])!;
    seed([{ ...clip("s1", "2026-09-09T10:20:00.000Z"), sessionSeconds: 60 * 60 }]);
    const long = doseOf(buildWorkouts()[0])!;
    expect(long).toBeGreaterThan(short);
  });
});

describe("local calendar days (P0-5)", () => {
  // slice(0,10) takes the UTC day off an ISO string, so an evening session in
  // Asia landed on the next day — wrong calendar square, wrong week.
  it("dayKey uses the local day, not the UTC day", () => {
    const late = new Date(2026, 8, 9, 23, 30); // 9 Sep 23:30 local, whatever the zone
    expect(dayKey(late)).toBe("2026-09-09");
  });

  it("just after midnight belongs to the new day", () => {
    expect(dayKey(new Date(2026, 8, 10, 0, 15))).toBe("2026-09-10");
  });

  it("pads single-digit months and days", () => {
    expect(dayKey(new Date(2026, 0, 5, 12, 0))).toBe("2026-01-05");
  });
});
