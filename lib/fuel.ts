// FUEL — food as a TRAINING input, not a diet tracker. One meal photo →
// /api/fuel (vision model) → macro estimate; meals live locally in ml_fuel.
// Protein is the hero number: target = 1.6 g/kg body weight (the
// sports-nutrition consensus for people who train), from the profile.

export type Meal = {
  id: string;
  date: string; // ISO
  dish: string;
  protein: number;
  carbs: number;
  fat: number;
  kcal: number;
};

export function getMeals(): Meal[] {
  try {
    return JSON.parse(localStorage.getItem("ml_fuel") ?? "[]") as Meal[];
  } catch {
    return [];
  }
}

export function todayMeals(): Meal[] {
  const k = new Date().toDateString();
  return getMeals().filter((m) => new Date(m.date).toDateString() === k);
}

export function logMeal(m: Omit<Meal, "id" | "date">): Meal {
  const meal: Meal = { ...m, id: Math.random().toString(36).slice(2, 10), date: new Date().toISOString() };
  const all = [...getMeals(), meal].slice(-200);
  localStorage.setItem("ml_fuel", JSON.stringify(all));
  return meal;
}

export function removeMeal(id: string) {
  localStorage.setItem("ml_fuel", JSON.stringify(getMeals().filter((m) => m.id !== id)));
}

export function restoreMeal(meal: Meal) {
  if (getMeals().some((m) => m.id === meal.id)) return;
  const all = [...getMeals(), meal].sort((a, b) => a.date.localeCompare(b.date)).slice(-200);
  localStorage.setItem("ml_fuel", JSON.stringify(all));
}

// 1.6 g/kg/day. Null when the user has not given a weight — a target computed
// against an assumed 65 kg body is a made-up number, not a default.
export function proteinTarget(): number | null {
  try {
    const p = JSON.parse(localStorage.getItem("ml_profile") ?? "{}") as { weight?: number };
    return p.weight ? Math.round(p.weight * 1.6) : null;
  } catch {
    return null;
  }
}
