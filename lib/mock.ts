// Mock data for the MotionLab 2.0 prototype.
// No real AI yet — this represents the SHAPE of data the real engine will return,
// so we can design the UI/flow around it.

export type Rating = "good" | "okay" | "work";

export type Tip = {
  rating: Rating;
  // Plain-language, no jargon. Always "praise first, then coach".
  title: string;
  detail: string;
  // where on the body / timeline this refers to (for the video overlay)
  bodyPart: string;
};

export type Analysis = {
  id: string;
  sport: string;          // auto-detected by the multimodal model
  action: string;         // e.g. "Forehand"
  emoji: string;
  date: string;
  score: number;          // 0-100 overall
  headline: string;       // one plain-language summary line
  tips: Tip[];
  // metrics stay internal in the real product; shown here only as friendly bars
  qualities: { label: string; value: number }[];
};

export const SPORTS = [
  { key: "swim", label: "Swimming", emoji: "" },
  { key: "run", label: "Running", emoji: "" },
  { key: "basketball", label: "Basketball", emoji: "" },
  { key: "tennis", label: "Tennis", emoji: "" },
  { key: "golf", label: "Golf", emoji: "" },
  { key: "yoga", label: "Yoga", emoji: "" },
  { key: "lift", label: "Strength", emoji: "" },
  { key: "dance", label: "Dance", emoji: "" },
];

export const DEMO_ANALYSIS: Analysis = {
  id: "demo",
  sport: "Tennis",
  action: "Forehand",
  emoji: "",
  date: "Today",
  score: 78,
  headline: "Smooth swing and great rhythm! Work on your balance at contact and you'll improve fast.",
  tips: [
    {
      rating: "good",
      title: "Great racket prep",
      detail: "Your setup before the shot looks great — nice shoulder turn, so your power flows naturally. Keep it up!",
      bodyPart: "Shoulders / rotation",
    },
    {
      rating: "work",
      title: "You lean back at contact",
      detail: "Right when you hit the ball, your body tips backwards and the power leaks away. Try pressing your weight into your front foot — like you're walking into the ball.",
      bodyPart: "Balance / front foot",
    },
    {
      rating: "okay",
      title: "Finish your follow-through",
      detail: "You cut the swing short after contact. Let the racket wrap naturally over your opposite shoulder — it'll feel steadier and easier.",
      bodyPart: "Arm / follow-through",
    },
  ],
  qualities: [
    { label: "Smoothness", value: 85 },
    { label: "Power flow", value: 68 },
    { label: "Balance", value: 62 },
    { label: "Rhythm", value: 80 },
  ],
};

export const HISTORY: { id: string; sport: string; emoji: string; action: string; date: string; score: number }[] = [
  { id: "h5", sport: "Tennis", emoji: "", action: "Forehand", date: "Today", score: 78 },
  { id: "h4", sport: "Tennis", emoji: "", action: "Forehand", date: "3 days ago", score: 74 },
  { id: "h3", sport: "Running", emoji: "", action: "Gait", date: "Last week", score: 71 },
  { id: "h2", sport: "Tennis", emoji: "", action: "Serve", date: "Last week", score: 66 },
  { id: "h1", sport: "Tennis", emoji: "", action: "Forehand", date: "2 weeks ago", score: 63 },
];

export function ratingColor(r: Rating) {
  return r === "good" ? "signal-good" : r === "okay" ? "signal-okay" : "signal-work";
}
