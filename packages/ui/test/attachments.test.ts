// What the UI says of an attachment and where its link goes (design D230).
import type { Attachment } from "@astrotime/core";
import { describe, expect, test } from "vite-plus/test";

import {
  attachmentHref,
  attachmentText,
  kindOf,
  sizeText,
  typedLink,
} from "../src/calendar/attachments.ts";
import { createI18n } from "../src/i18n/index.ts";

const en = createI18n("en").t;
const ru = createI18n("ru").t;
const file = (fields: Partial<Attachment>): Attachment => ({
  uri: "https://x.org/f",
  name: null,
  type: null,
  size: null,
  inline: false,
  ...fields,
});

describe("where a link goes", () => {
  test("a link relative to the server, as Nextcloud Calendar writes a user's file", () => {
    expect(
      attachmentHref(
        "/index.php/f/241",
        "https://cloud.example.com/remote.php/dav/calendars/astro/work/",
      ),
    ).toBe("https://cloud.example.com/index.php/f/241");
  });

  test("only the web's links are followed", () => {
    expect(attachmentHref("https://example.org/a b", undefined)).toBe("https://example.org/a%20b");
    expect(attachmentHref("javascript:alert(1)", undefined)).toBeNull();
    expect(attachmentHref("data:text/html,<b>x</b>", undefined)).toBeNull();
    expect(attachmentHref("ftp://example.org/f", undefined)).toBeNull();
    // Relative with nothing to be relative to: no link.
    expect(attachmentHref("/index.php/f/241", undefined)).toBeNull();
  });
});

describe("a kind in a word", () => {
  test("the name's extension first, then the known type's, then what the type says", () => {
    expect(kindOf(file({ name: "Q3.docx", type: "application/octet-stream" }), en)).toBe("DOCX");
    expect(kindOf(file({ type: "text/plain" }), en)).toBe("TXT");
    // A version or a number after the last dot is no extension.
    expect(kindOf(file({ name: "Release v1.2", type: "application/pdf" }), en)).toBe("PDF");
    expect(kindOf(file({ name: "Budget 3.5" }), en)).toBeNull();
    expect(kindOf(file({ type: "text/plain; charset=utf-8" }), en)).toBe("TXT");
    expect(
      kindOf(
        file({ type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        en,
      ),
    ).toBe("XLSX");
    expect(kindOf(file({ type: "image/x-portable-anymap" }), en)).toBe("Image");
    expect(kindOf(file({ type: "image/x-portable-anymap" }), ru)).toBe("Изображение");
    // No word a reader knows: none, never "VND" or "PLAIN".
    expect(kindOf(file({ type: "application/vnd.acme.thing" }), en)).toBeNull();
    expect(kindOf(file({}), en)).toBeNull();
  });
});

describe("a size", () => {
  test("in the language's units, promoted when rounding reaches the next", () => {
    expect(sizeText(22, "en", en)).toBe("22 B");
    expect(sizeText(22, "ru", ru)).toBe("22 Б");
    expect(sizeText(482_133, "en", en)).toBe("482 kB");
    expect(sizeText(1_500, "en", en)).toBe("1.5 kB");
    expect(sizeText(999_500, "en", en)).toBe("1 MB");
    expect(sizeText(999_499, "en", en)).toBe("999 kB");
    expect(sizeText(3_240_000, "en", en)).toBe("3.2 MB");
  });

  test("a row's words: the name, else the link's host and path; its kind and size", () => {
    expect(
      attachmentText(file({ name: "a.pdf", size: 2_048 }), "https://x.org/f", en, "en"),
    ).toEqual({ name: "a.pdf", about: "PDF · 2 kB" });
    expect(attachmentText(file({}), "https://example.com/budget/sheet", en, "en")).toEqual({
      name: "example.com/budget/sheet",
      about: "",
    });
    // A link that is not followed shows as written.
    expect(attachmentText(file({ uri: "javascript:alert(1)" }), null, en, "en").name).toBe(
      "javascript:alert(1)",
    );
    expect(attachmentText(file({ uri: null, inline: true, size: 3 }), null, en, "en")).toEqual({
      name: "File",
      about: "3 B",
    });
  });
});

test("a link typed: http(s) as written, else https:// before it, a host with a port or no dot too", () => {
  expect(typedLink("example.org/minutes")).toBe("https://example.org/minutes");
  expect(typedLink("  http://example.org  ")).toBe("http://example.org/");
  expect(typedLink("nas:8080/files/a.pdf")).toBe("https://nas:8080/files/a.pdf");
  expect(typedLink("localhost")).toBe("https://localhost/");
  expect(typedLink("nas/share")).toBe("https://nas/share");
  expect(typedLink("not a link")).toBeNull();
  expect(typedLink("javascript:alert(1)")).toBeNull();
  expect(typedLink("mailto:me@example.org")).toBeNull();
  expect(typedLink("ftp://example.org/f")).toBeNull();
  expect(typedLink("")).toBeNull();
});
