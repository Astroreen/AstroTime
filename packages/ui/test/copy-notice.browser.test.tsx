// The "Copy made" notice (design D164) goes by itself 8 seconds after it
// shows, however often the screen around it is drawn again meanwhile:
// a new `onClose` from a parent's render does not start the time again.
// The clock is Vitest's, so nothing waits.
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { CalendarObject } from "@astrotime/core";

import type { Target } from "../src/calendar/editing.ts";
import { CopyNotice } from "../src/components/change-notice.tsx";
import { createI18n } from "../src/i18n/index.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
});

const object = CalendarObject.parse(
  "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//EN\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTAMP:20261101T000000Z\r\nDTSTART:20261105T100000Z\r\nSUMMARY:Copy\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
);
const copied: Target = {
  objectId: "copy",
  calendarId: "c",
  object,
  recurrenceId: null,
  item: object.master!,
};

test("the notice closes 8 seconds after it shows, though its parent draws it again meanwhile", () => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const i18n = createI18n("en");
  cleanups.push(() => {
    root.unmount();
    host.remove();
  });
  const closes: number[] = [];
  // Each render hands a new `onClose`, as a parent's inline arrow does.
  const draw = (n: number) =>
    flushSync(() =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <CopyNotice copied={copied} onOpen={() => {}} onClose={() => closes.push(n)} />
        </I18nextProvider>,
      ),
    );
  draw(1);
  expect(host.textContent).toContain("Copy made");
  vi.advanceTimersByTime(5000);
  draw(2);
  vi.advanceTimersByTime(2999);
  draw(3);
  expect(closes).toEqual([]);
  vi.advanceTimersByTime(1);
  // Closed at 8 seconds, by the latest `onClose`.
  expect(closes).toEqual([3]);
});
