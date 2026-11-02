// The "Copy made" notice (design D164) goes by itself 8 seconds after it
// shows, however often the screen around it is drawn again meanwhile:
// a new `onClose` from a parent's render does not start the time again.
// The clock is Vitest's, so nothing waits.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { CalendarObject } from "@astrotime/core";

import type { Target } from "../src/calendar/editing.ts";
import { CopyNotice } from "../src/components/copy-notice.tsx";
import { createI18n } from "../src/i18n/index.ts";

// React's `act` runs every update and effect an event starts before it
// returns, a pointer's (continuous) ones too, so the test sees each at once.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    act(() => root.unmount());
    host.remove();
  });
  const closes: number[] = [];
  // Each render hands a new `onClose`, as a parent's inline arrow does.
  const draw = (n: number) =>
    act(() =>
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

test("the notice waits while the focus is in it or a pointer over it, and gets its 8 seconds again after", () => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const i18n = createI18n("en");
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  const onClose = vi.fn();
  act(() =>
    root.render(
      <I18nextProvider i18n={i18n}>
        <CopyNotice copied={copied} onOpen={() => {}} onClose={onClose} />
      </I18nextProvider>,
    ),
  );
  const open = [...host.querySelectorAll("button")].find((b) => b.textContent === "Open")!;
  vi.advanceTimersByTime(5000);
  act(() => open.focus());
  vi.advanceTimersByTime(60_000);
  expect(onClose).not.toHaveBeenCalled();
  act(() => open.blur());
  vi.advanceTimersByTime(7999);
  expect(onClose).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(onClose).toHaveBeenCalledOnce();
});

test("a pointer over the notice holds it as well", () => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  const onClose = vi.fn();
  act(() =>
    root.render(
      <I18nextProvider i18n={createI18n("en")}>
        <CopyNotice copied={copied} onOpen={() => {}} onClose={onClose} />
      </I18nextProvider>,
    ),
  );
  const notice = host.querySelector<HTMLElement>('[role="status"]')!;
  const pointer = (type: string, relatedTarget: EventTarget | null) =>
    act(() => notice.dispatchEvent(new PointerEvent(type, { bubbles: true, relatedTarget })));
  pointer("pointerover", document.body);
  vi.advanceTimersByTime(60_000);
  expect(onClose).not.toHaveBeenCalled();
  pointer("pointerout", document.body);
  vi.advanceTimersByTime(7999);
  expect(onClose).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(onClose).toHaveBeenCalledOnce();
});

test("a notice closed while held does not hold the next one", () => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const i18n = createI18n("en");
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  const onClose = vi.fn();
  const draw = (shown: Target | null) =>
    act(() =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <CopyNotice copied={shown} onOpen={() => {}} onClose={onClose} />
        </I18nextProvider>,
      ),
    );
  draw(copied);
  const notice = host.querySelector<HTMLElement>('[role="status"]')!;
  act(() =>
    notice.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, relatedTarget: null })),
  );
  // Closed from under the pointer (its ✕, or Open): no pointer leaves it.
  draw(null);
  draw({ ...copied, objectId: "another" });
  vi.advanceTimersByTime(8000);
  expect(onClose).toHaveBeenCalledOnce();
});
