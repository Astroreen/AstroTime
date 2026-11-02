// A mention in a description, as the details draw it (docs/plans/design.md#D208):
// a chip with the person's name; a tap shows their e-mail, a link to write
// to them. It is a link to `mailto:` with "@" words in the text.
import { useState } from "react";

/** The person a link names, when it is a mention: `[@Anna Berg](mailto:anna@example.com)`. */
export function mentionIn(
  href: string,
  words: readonly unknown[],
): { readonly name: string; readonly email: string } | null {
  const [only] = words;
  if (words.length !== 1 || typeof only !== "string" || !only.startsWith("@")) return null;
  const email = /^mailto:([^?]+)/i.exec(href)?.[1];
  const name = only.slice(1).trim();
  return email && name ? { name, email: decoded(email) } : null;
}

/** An address as written, decoded; one that does not decode (a stray "%") as it is. */
function decoded(address: string): string {
  try {
    return decodeURIComponent(address);
  } catch {
    return address;
  }
}

export function MentionChip({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1 align-baseline">
      <button
        type="button"
        aria-expanded={open}
        title={email}
        onClick={() => setOpen(!open)}
        className="rounded-full bg-accent-soft px-2 py-px font-medium text-ink hover:brightness-110 focus-visible:outline-2 focus-visible:outline-accent"
      >
        @{name}
      </button>
      {open && (
        <a
          href={`mailto:${email}`}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-accent underline underline-offset-2"
        >
          {email}
        </a>
      )}
    </span>
  );
}
