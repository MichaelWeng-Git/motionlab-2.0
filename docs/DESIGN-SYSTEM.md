# MotionLab 2.0 — design system

Not an aspiration. Every value below was **measured from the current codebase**;
the "drift" columns are real counts. The job is to collapse the drift onto the
canonical value, not to invent a new look.

Run the audit yourself before starting — the counts will have moved:

```bash
grep -rhoE "rounded-(\[[0-9]+px\]|full|none|sm|md|lg|xl|2xl|3xl)" app components | sort | uniq -c | sort -rn
grep -rhoE "shadow-(soft|lift|\[[^]]+\]|sm|md|lg|xl|none)" app components | sort | uniq -c | sort -rn
grep -rnoE '<h[12][^>]*className="[^"]*"' app components | grep -v font-golden
```

---

## 1. Corner radius

The same object — a card — is currently drawn at **six different radii**, and
several pages mix three of them on one screen (`app/streak/page.tsx` uses 26, 28,
30 *and* `rounded-3xl`).

### Canonical scale

| role | class | px | why |
|---|---|---|---|
| **Card / panel** | `rounded-2xl` or `.gk-card` | **24** | `.gk-card` is already 24px and `rounded-2xl` resolves to 24px — the app's most-used named radius (93 uses) |
| **Large surface** — full-bleed hero, sheet, modal | `rounded-3xl` | **32** | genuinely larger objects; 45 uses |
| **Inner tile** — a box inside a card | `rounded-xl` | **17.6** | keeps nesting legible: inner radius must be visibly smaller than its parent |
| **Pill / chip / button / avatar** | `rounded-full` | — | 265 uses, already consistent |
| **Hairline marks** — bar caps, tick marks | `rounded-[3px]` | 3 | the one legitimate arbitrary value |

### Drift to remove

| current | count | replace with |
|---|---|---|
| `rounded-[26px]` | 25 | `rounded-2xl` (24) |
| `rounded-[28px]` | 17 | `rounded-2xl` (24) |
| `rounded-[30px]` | 12 | `rounded-3xl` (32) if it is a hero/sheet, else `rounded-2xl` |
| `rounded-[24px]` | 4 | `rounded-2xl` — identical value, just untokenised |
| `rounded-[32px]` `[22px]` `[18px]` `[14px]` `[9px]` | 1 each | nearest role above |

**Rule.** No arbitrary radius except `rounded-[3px]`. If a new size feels
necessary, the object is probably the wrong role — pick the role first.

**Nesting rule.** A child's radius must be smaller than its parent's, never
equal. A 24px tile inside a 24px card reads as a rendering bug.

---

## 2. Typography

Two faces, and the split is deliberate:

- **`.font-golden`** — Lilita One. **Display and every number.** Section
  headers, scores, stats, counts, button labels in caps.
- **system sans** (`-apple-system` → Inter → system-ui) — body, running text,
  anything small. Lilita's letter-spacing is too tight at small sizes; this was
  tried app-wide and rejected.

### Rules

1. **Every number the athlete reads is `font-golden`** — scores, percentages,
   durations, counts. A number in the body face looks like a typo next to one
   that isn't.
2. **Every section header is `font-golden`**, uppercase, `leading-none`.
3. Lilita ships **one weight**. Never `font-bold` on `.font-golden` — the
   browser synthesises it into mush. `app/globals.css` already guards this.
4. Units stay in the body face at a smaller size, muted:
   `<span className="font-golden text-[40px]">31<span className="ml-1 font-sans text-sm font-bold text-ink-soft">min</span></span>`

### Drift to remove

**34 `<h1>`/`<h2>` still use `text-…px font-extrabold tracking-tight`** instead of
`font-golden` — page titles on `/fuel`, `/form`, `/charge`, `/weeks`, `/streak`,
`/tree` and Home. Convert them:

```
text-[22px] font-extrabold tracking-tight   →   font-golden text-[24px] leading-none
text-2xl    font-extrabold tracking-tight   →   font-golden text-[26px] leading-none
```

Size up ~2px when converting: Lilita's x-height is smaller, so a same-`px`
swap reads smaller than what it replaced.

### Scale

| role | size |
|---|---|
| page title | `font-golden text-[24px] leading-none` |
| section header | `font-golden text-[13px]` uppercase |
| hero number | `font-golden text-[40–46px] leading-none` |
| card number | `font-golden text-[19–26px] leading-none` |
| body | `text-[13px] font-semibold` |
| caption / meta | `text-[11px] font-bold text-ink-muted` |

---

## 3. Elevation

Two shadows, both already tokenised. **142** uses of `shadow-soft`, **69** of
`shadow-lift`, and **6 one-off inline shadows** that should be folded in.

| token | use |
|---|---|
| `shadow-soft` | resting cards, chips, rows — the default |
| `shadow-lift` | raised objects: the primary action, a dark hero card, anything that floats |

**Rule.** No inline `shadow-[...]` unless the effect is genuinely not elevation
(e.g. the inset field shadow on the login input, which is legitimate). Glows are
not shadows — a coloured glow belongs in a `filter: drop-shadow`, and needs
`overflow: visible` or it clips into a hard straight edge (this has bitten the
Gauge and the curve end-dot before).

---

## 4. Colour

**`lib/palette.ts` is the single source for any "how good is this number"
colour.** Do not introduce local thresholds — four divergent scales used to
exist and produced a 73 that rendered amber on one screen and green on another.

```ts
qualityColor(v)    // higher is better: ≥70 green, ≥50 amber, else red
intensityColor(v)  // higher is MORE: ≥85 red, ≥55 amber, else green
SIGNAL.good/okay/work
```

These are byte-identical to Tailwind's `signal.*` tokens — keep them that way.

Surface palette (`tailwind.config.ts`): `ink` / `ink-soft` / `ink-muted`,
`paper` / `paper-card`, `volt` (deep-green actions), `volt-glow` `#FF9A66`
(the one warm accent — flame, coins, route only), `volt-mist` (selected states).

**Card grounds** — `bg-graphite` `#14181B` is the app's ONE dark card ground
(TODAY, GoalRing, every dark hero); `bg-cream` `#F3F0E8` is the warm paper used
by the day-intensity card. Both also exist as `SURFACE.*` in `lib/palette.ts`
for inline styles — Tailwind cannot read a TS constant, so the value lives in
two files and **must not drift**.

**`award.*`** — `gold` / `gold-light` / `gold-pale` / `gold-wash` / `silver` /
`bronze`. Podium ranks, medal tiers, deluxe pack trim. `AWARD` in
`lib/palette.ts` additionally carries `edge`/`light` shades so illustrated
medals shade from the same source (`components/MedalArt.tsx` imports it rather
than keeping its own table).

**`heat.1–4`** — a sequential ramp for DENSITY (activity heatmaps, streak
calendars): "how much", not "how good". The signal scale is categorical and
cannot express this; reaching for it paints red squares on a calendar, which
reads as failure rather than volume.

### Why this section exists

A parallel palette had started growing: `#10271F` (27 uses) sat **7.0** RGB
units from `ink`, `#E8B23E` sat 17.1 from `signal.okay`, `#EAF4EE` sat 19.6
from `volt-mist`. Individually invisible; on one screen they read as a
rendering fault. Near-duplicates are the drift that actually hurts — an
obviously wrong colour gets noticed and fixed.

**Before adding a colour, check whether the role already has a token.** If the
role genuinely has none (a podium rank, a density ramp), add it to BOTH
`tailwind.config.ts` and `lib/palette.ts` and document it here — do not inline
a hex.

Dark surfaces in use: `#14181B` (TODAY / GoalRing ground) and `#F3F0E8` cream
(day-intensity card). **Card surface colour is not decoration** — the 3D body
reads a different colour on cream than on white, so a card showing the body
matches Home's white.

---

## 5. Iconography

**No Apple emoji anywhere.** Stroke SVGs via `components/SIcon.tsx` and
`components/Icons.tsx`. Existing icons are 1.6–2px stroke, `strokeLinecap`
and `strokeLinejoin` round.

---

## 6. Shared components — reuse, do not redraw

| component | owns |
|---|---|
| `Gauge` | the one semicircle. `value` may be a word ("Moderate"), so the type scales to string length — keep that |
| `GoalRing` | the three-arc ring, Home and `/weeks` |
| `ScoreRing` | the report hero score |
| `MuscleBody3D` | the 3D body; `dolly` zooms without resizing the container |
| `SaveSuccess` | the save celebration — mount it wherever a form saves |
| `Skeleton` | route loading states |

---

## What NOT to do

- Do not restyle to taste. This document collapses drift onto values already in
  the codebase; a redesign is a separate, explicit request.
- Do not change `lib/palette.ts` thresholds.
- Do not convert small body text to `.font-golden` — that was tried and rejected.
- Do not touch the numbers themselves. This is presentation only: no formula,
  no data source, no `REF_SESSION_SCALE` / `WEEK_FULL` / `bodyScale` /
  `computeRecovery`.
- One item per commit, as in [CHECKLIST.md](CHECKLIST.md): radius pass, then
  typography pass, then elevation pass — separately, so a bad one can be
  reverted alone.
