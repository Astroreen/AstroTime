# PR 35, second version: white text on fills darkened as far as it needs

- `after/` — `fix/accessibility` at 0a51bda (rebased on main c0bf89f; the colours are unchanged since 485575c), the same demo data with the
  clock frozen on Wednesday, November 4, 2026, 10:40 Vilnius. Names:
  `<view>-<theme>-<language>-<size>.png`. Compare with `../pr-35/before/`
  (main) and `../pr-35/after/` (the first version, black or white text).
- Item text is white, as in the owner's reference (Google Calendar on
  Android). The fill is the calendar's colour scaled down in linear light
  until its WCAG luminance is at most 0.18, so white reaches 4.57:1 (design
  D120). Colours already that dark are drawn as they are. The drawer's
  checkboxes use the same fill, with a white mark.
- `e2e.log` — `CI=1 pnpm run e2e` in `apps/web`: 106 passed, 25 skipped
  (the screenshot specs), 0 failed; `a11y.spec.ts` with no axe violation.
- `a11y-on-main-ui.log` — the same `a11y.spec.ts` run with `packages/ui/src`
  as on `main` (acd2866): 18 of its 30 tests fail, 14 of the 17
  axe audits (`color-contrast`, `label-content-name-mismatch`,
  `target-size`) and 4 of the 13 checks axe cannot see.
- `pale-colours-dark.png`, `pale-colours-light.png` — pale and mid-tone
  calendar colours (Google's banana `#f6bf26`, a pale yellow, cyan, salmon,
  lavender, Nextcloud's blue, the demo's green, one already dark): as the
  server has them, as drawn (design D120), and done, in each theme. Drawn
  with the app's own `styles.css` on the dev server.
