# PR 35 — accessibility: an axe audit in CI and what it found

- `before/` — `main` (bba4599), `after/` — `fix/accessibility`, the same demo
  data with the clock frozen on Wednesday, November 4, 2026, 10:40 Vilnius.
  Names: `<view>-<theme>-<language>-<size>.png`. The colour change shows
  most in `agenda-*`: text on a calendar's colour is now black or white by
  WCAG luminance (design D120), so the green and purple items have black
  text at ≥ 4.5:1 where white was 3.3:1.
- `e2e.log` — `CI=1 pnpm run e2e` in `apps/web`: 103 passed, 25 skipped,
  the 27 tests of `a11y.spec.ts` among them with no axe violation.
