// The edit dialog's description, where "@" offers people from the item's
// account (docs/plans/design.md#D208): its server's users, as Nextcloud's
// Calendar finds attendees. A person picked is written as a Markdown link
// to their e-mail, `[@Anna Berg](mailto:anna@example.com)`, which reads in
// any client and which the details draw as a chip; it invites no one.
import type { Person } from "@astrotime/core";
import { connectCalDav } from "@astrotime/sync";
import { peopleOf } from "@astrotime/sync/people";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAccounts } from "./accounts-context.tsx";
import { row } from "./select.tsx";

/** "@" and what follows it up to the caret, at a word's start: the query. */
const TYPED = /(?:^|[\s(])@([^\s@[\]()]{0,40})$/u;
/** Letters before a server is asked, and how long typing rests first. */
const FROM = 2;
const REST_MS = 250;

interface Query {
  readonly text: string;
  /** Where its "@" is, and the caret. */
  readonly start: number;
  readonly end: number;
}

/**
 * An e-mail as a link's address: what would end it or break it (a space,
 * brackets, "%", "<", ">", a quote, a backslash; "?" and "#", which start a
 * query or a fragment) percent-encoded; the rest as written,
 * so it reads in other clients.
 */
export function addressOf(email: string): string {
  return email.replace(/[\s%()<>"[\]\\?#]/g, (char) =>
    [...new TextEncoder().encode(char)]
      .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`)
      .join(""),
  );
}

/** How a person picked is written into the description. */
export function mentionOf(person: Person): string {
  // Only what would change a link's words is escaped (brackets, a backslash,
  // emphasis, code, a tag): the name reads as written here and, with as few
  // backslashes as can be, in clients that show the text as it is.
  const name = person.name.replace(/[[\]\\*_`~<]/g, "\\$&");
  return person.email ? `[@${name}](mailto:${addressOf(person.email)})` : `@${name}`;
}

export function MentionField({
  value,
  onChange,
  accountId,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** The account of the item's calendar; `null` on this device, where no one is offered. */
  accountId: string | null;
  label: string;
  className: string;
}) {
  const { t } = useTranslation();
  const { platform, store } = useAccounts();
  const listId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<Query | null>(null);
  // What a search found, and for which account and words: another account's
  // people are never offered for this one's.
  const [found, setFound] = useState<{
    readonly accountId: string | null;
    readonly text: string;
    readonly people: Person[];
  }>({ accountId: null, text: "", people: [] });
  const [active, setActive] = useState(0);
  // What each query found, while the dialog is open: typing back asks nothing again.
  const [known] = useState(() => new Map<string, Person[]>());
  const [connect] = useState(() => connectCalDav(platform.http));
  /** Where the caret goes once a mention is in. */
  const caret = useRef<number | null>(null);

  const text = query && query.text.length >= FROM ? query.text : null;
  useEffect(() => {
    if (!text || !accountId) return;
    const key = `${accountId} ${text.toLowerCase()}`;
    const cached = known.get(key);
    if (cached) {
      setFound({ accountId, text, people: cached });
      return;
    }
    let live = true;
    // The server is asked once typing rests, not on every letter.
    const timer = setTimeout(() => {
      void peopleOf({ store, secrets: platform.secrets, connect }, accountId, text).then(
        (people) => {
          // Only an answer is kept: a search that failed is asked again.
          if (people) known.set(key, people);
          if (live) setFound({ accountId, text, people: people ?? [] });
        },
      );
    }, REST_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [text, accountId, store, platform, connect, known]);

  useEffect(() => {
    if (caret.current === null || !field.current) return;
    field.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [value]);

  const people = text && found.text === text && found.accountId === accountId ? found.people : [];
  const open = people.length > 0;
  const shown = Math.min(active, people.length - 1);

  const read = (element: HTMLTextAreaElement) => {
    const at = element.selectionStart;
    const typed = at === element.selectionEnd ? TYPED.exec(element.value.slice(0, at)) : null;
    setQuery(typed ? { text: typed[1]!, start: at - typed[1]!.length - 1, end: at } : null);
    setActive(0);
  };

  const pick = (person: Person) => {
    if (!query) return;
    const written = `${mentionOf(person)} `;
    caret.current = query.start + written.length;
    onChange(value.slice(0, query.start) + written + value.slice(query.end));
    setQuery(null);
  };

  return (
    <div className="relative">
      <textarea
        ref={field}
        aria-label={label}
        placeholder={label}
        value={value}
        rows={4}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${shown}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          read(e.target);
        }}
        onSelect={(e) => read(e.currentTarget)}
        onBlur={() => setQuery(null)}
        onKeyDown={(e) => {
          if (!open || e.nativeEvent.isComposing) return;
          const move = { ArrowDown: 1, ArrowUp: -1 }[e.key];
          if (move !== undefined) {
            e.preventDefault();
            setActive((shown + move + people.length) % people.length);
          } else if (e.key === "Enter") {
            // Enter picks; Tab leaves the field as anywhere (WAI-ARIA's combobox).
            e.preventDefault();
            pick(people[shown]!);
          } else if (e.key === "Escape") {
            // Closes the list, not the dialog.
            e.preventDefault();
            e.stopPropagation();
            setQuery(null);
          }
        }}
        className={className}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("mention.people")}
          className="absolute inset-x-0 top-full z-10 mt-1 max-h-60 overflow-y-auto overscroll-contain rounded-xl bg-raised p-1 text-ink shadow-xl ring-1 ring-line"
        >
          {people.map((person, index) => (
            <li
              key={`${person.email ?? ""} ${person.name}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === shown}
              data-highlighted={index === shown ? "" : undefined}
              // The field keeps the focus: a press picks, it does not blur.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(person)}
              className={row}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{person.name}</span>
                {person.email && (
                  <span className="truncate text-note text-ink-muted">{person.email}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
