# Assistant plan

Status: **planned** — decided in the
[grilling of 2026-11-06](../grilling/2026-11-06-assistant.md), nothing built
yet. This plan owns turning words into items and letting an AI assistant at
the user's calendars: the quick parse of a typed or spoken line, voice
input, and AstroTime's MCP server. It builds on foundation's
[D24](foundation.md#D24) (the core is isomorphic), [D5](foundation.md#D5)
(the store is the UI's truth, only the sync engine talks to servers) and
[D7](foundation.md#D7) (nothing lost), and on the quick create of design
[D296](design.md#D296). Its decisions are D300–D311.

## Goal

The owner, 2026-11-06: "record a voice, then speech-to-text, pick out the
keywords, and when an event or task is created it all fits itself in; a
small model can run on the client offline, and if a shared server is
connected the audio can go there", and "add an MCP server".

So: a line such as «завтра в 13 обед с Машей в Кофемании 1 час», typed or
spoken, becomes an item with its day, time, length, place and kind filled
in, for the user to check and save; and any AI assistant that speaks MCP
(Claude, Cursor, Copilot, Codex, Gemini CLI, a local model) can read and
change the user's events and tasks.

## Decisions

### The quick parse

- **D300. `parseQuick`: one parser, a language a file.** `parseQuick(text,
  { locale, now, zone })` in `@astrotime/core` returns the line's pieces,
  each with its span in the text: a start (a day, or a day and a time), an
  end or a length, an all-day flag, a place, the kind (event or task), a
  reminder, and the title that is left. Rules, not a model: offline,
  instant, the same on every platform, and testable.
  - **Dates and times** are `chrono-node`'s (its locales in 2.10.3: ar,
    de, en, es, fi, fr, id, it, ja, nl, pt, ru, sv, uk, vi, zh). PR AS2
    shows its packed ESM imports no Node or DOM module
    ([foundation D24](foundation.md#D24)), imports each language's entry
    point alone (`chrono-node/en`, `chrono-node/ru`), never the index of
    all, and the parser is a chunk that loads with quick create, not on
    the first load ([foundation D145](foundation.md#D145)).
  - **The zone is AstroTime's.** chrono reads against a reference instant
    and an offset, not an IANA zone: `parseQuick` takes its wall-clock
    pieces (a day, an hour) and resolves them in `zone` with core's own
    time code, so a DST gap or a late hour is resolved as the editor
    resolves it.
  - **The rest** is a **language pack**, `parse/<lang>.ts`: data in one
    schema for every language (words that open a place, «в», "at", "bei";
    lengths, «1 час», "for 2 hours"; words that make a task, «купить»,
    «сделать», "buy", "call"; reminders, «напомни за час»). A contributor
    adds a language with one file and its tests and no code.
  - **English and Russian first**; the pack follows the app's language,
    and a line in which it finds nothing is tried with the other packs.
  - Folding is search's ([design D97](design.md#D97)), so «ё» and case do
    not matter.
    _Alternative:_ a language model; rejected for now, it is heavy, slow on
    a phone and not the same everywhere.
- **D301. What was understood is shown in the title.** Quick create
  ([design D296](design.md#D296)) runs `parseQuick` as the title is typed:
  each span understood is marked in the title (the accent's soft fill), and
  its value fills the sheet's rows at once. The title saved is the words
  left. A mark tapped is undone (its words go back to the title, its row to
  what it was); a row the user set by hand is never overwritten by a later
  parse.
  - **The title stays a plain `<input>`.** The marks are an overlay behind
    it (a mirror of the input with its font, padding and scroll, its text
    transparent, the spans filled), `aria-hidden`, so the accessibility
    tree holds one text field as before. What was understood is said by
    the rows themselves and once more by a polite live region ("Friday,
    13:00–14:00, Кофемания") after typing pauses on a change. Undoing a
    mark is also in the row's own menu ("Keep in the title"), so it needs
    no tap on the overlay.
  - **IME composition**: the line is parsed on `compositionend`, never in
    the middle of a composition; Enter that ends a composition does not
    save, as [design D206](design.md#D206)'s "Custom…" already holds.
    Enter saves and Escape closes as [design D296](design.md#D296) says.

### Voice

- **D302. Voice is off until the user picks a recogniser.** Settings →
  Voice offers: **Off** (the default, on every platform), **System
  (Android)**, **Whisper on this device**, **Server**, and **Automatic**
  (the server when it answers, else Whisper on this device). Off, there is
  no microphone button anywhere: a phone's keyboard has its own dictation,
  and its words go through `parseQuick` like typed ones. On, the button
  stands in quick create, beside "Save". Recording needs the microphone,
  which [foundation D110](foundation.md#D110)'s `Permissions-Policy` turns
  off (`microphone=()` in `apps/proxy/src/server.ts`): PR AS3 makes it
  `microphone=(self)`, the page's own and no frame's, and amends D110 then;
  the browser still asks the user the first time.
- **D303. Whisper on this device.** A Whisper model run in the page
  (WASM, WebGPU where there is one): tiny (about 40 MB), base (about 75 MB,
  the default) or small (about 250 MB), downloaded once, only after the user
  agrees in the setting (its size said), kept on the device and then used
  offline. The language spoken is detected, with the app's as the hint. It
  loads in a chunk of its own, never on the first load
  ([foundation D145](foundation.md#D145)). The runtime (its scripts and
  WebAssembly) is the app's own files, under the `wasm-unsafe-eval`
  [foundation D110](foundation.md#D110) already allows. The model is not:
  it comes from Hugging Face, a pinned revision whose files' SHA-256 the
  app knows, fetched from another origin only once the user agreed to it, as the place search names Photon
  ([foundation D178](foundation.md#D178)). On the web it is fetched through the
  proxy's `/models/` route, which reaches Hugging Face alone and follows
  its redirects itself only to Hugging Face's own download hosts (its
  CDN); the desktop and Android fetch it through the platform's HTTP. The
  client checks each whole file's SHA-256 before the runtime loads it and
  keeps none that differs. The runtime's workers are the app's own files
  (`worker-src 'self'`); one that would start a `blob:` worker is
  configured not to, or is not used.
- **D304. A server: any OpenAI-compatible one.** One interface,
  `POST /v1/audio/transcriptions`, as whisper.cpp's server, speaches
  (faster-whisper), LocalAI, OpenAI and Groq serve it. The setting takes
  the server's address and token, and the model is picked from what its
  `GET /v1/models` lists. The token is kept as an account's credentials
  are, in the platform's secrets ([foundation D89](foundation.md#D89),
  [android D64](android.md#D64), [desktop D74](desktop.md#D74)), never in
  the settings. Audio goes only to the server the user entered:
  "Automatic" means that server or this device, never another. The
  request goes through the platform's HTTP as CalDAV's does: on the web
  through the proxy ([foundation D39](foundation.md#D39)), so the page's
  `connect-src 'self'` stays. The proxy's allowlist is the operator's (an
  environment variable), not the user's: on the web a speech server is
  usable only when the operator listed its origin, or it is the image's own
  server, and an address off the list is refused in the setting with why
  ("this AstroTime's operator does not allow that server"). The desktop and
  Android take any address, from outside the page. PR AS3 amends D39 for
  the speech server's two paths and the `/models/` route of
  [D303](#D303).
  AstroTime's own server
  ([server D281](server.md#D281)) can serve the same endpoint; it is not
  required to.
- **D305. Android's own recogniser, offline only.** `SpeechRecognizer`
  with `EXTRA_PREFER_OFFLINE`, through a small Capacitor plugin: fast and
  nothing to download where the phone has the language's offline pack.
  Without one it says so rather than send the voice to Google; the setting
  is offered only where the system has a recogniser.
- **D306. What was said opens quick create, filled.** The words go through
  `parseQuick` into quick create with their marks ([D301](#D301)); nothing
  is saved until the user saves, so a misheard word never lands in a
  calendar silently.

### MCP

- **D307. `@astrotime/mcp`: AstroTime as an MCP server.** A package over
  the store (`@astrotime/core`, `@astrotime/storage`), not over CalDAV: what
  an assistant changes is a change in the store, sent by the sync engine
  like the user's own (foundation [D5](foundation.md#D5),
  [D7](foundation.md#D7)). Its tools: list the calendars; search items and
  list them over a range; get one; create an event or a task; change one
  (the fields it names, the rest kept); complete a task; add an attachment;
  delete; and `undo` on AstroTime's server ([D309](#D309)), where no
  window offers [D311](#D311)'s "Undo" (the desktop has none: its log is
  undone in Settings). Every tool's input is checked against its schema and its result is
  the item as the store holds it. Read-only tools carry `readOnlyHint`.
- **D308. First in the desktop app, beside the store.** The desktop app
  ([desktop D73](desktop.md#D73)) serves MCP's streamable HTTP on
  `127.0.0.1` only, behind a token, when Settings → Assistants turns it on
  (off by default). It writes the app's own database through the store, so
  the calendar shows a change at once and sync sends it. An attachment is
  taken by a path on this computer. A browser or a phone cannot be one: a
  page opens no port and its database is the browser's own.
  - **Through the window's store.** The database is the utility
    process's and its one page's ([desktop D73](desktop.md#D73)): nobody
    else is told of a commit. So the main process only listens; each tool
    call goes over IPC to the window, which runs it against its own store,
    as a click there would, and its answer comes back. The calendar on
    screen and sync both see the change. With no window open a call is
    answered that AstroTime must be open (a hidden or minimised window
    serves).
  - **Who may call.** It binds `127.0.0.1` alone. A request whose `Host`
    is not `127.0.0.1:<port>` or `localhost:<port>` is refused (DNS
    rebinding), and so is any request with an `Origin` (a page in a browser
    calling localhost; an MCP client sends none). The token is 32 random
    bytes in `Authorization: Bearer`, compared in constant time, kept with
    the credentials through `safeStorage` ([desktop D74](desktop.md#D74)),
    and "New token" in the setting replaces it at once.
- **D309. Then on AstroTime's server.** In server mode
  ([server D281](server.md#D281)) the server serves MCP at `/mcp` over the
  server's own data, no CalDAV round trip, for a token a user makes there:
  read only, or read and write. An attachment comes as its content. It keeps
  [D311](#D311)'s log in its database, per user, and its `undo` tool takes
  one entry under the same rule.
- **D310. Any assistant, not only Claude.** Settings → Assistants shows the
  address and token and copies a ready configuration for Claude (Desktop and
  Code), Cursor, VS Code (Copilot), Codex, Gemini CLI, LM Studio, and any
  other client as plain JSON.
- **D311. A deletion is asked; every change is kept to undo.** `delete`
  carries `destructiveHint`, so the assistant's client asks the user first.
  Every change through MCP goes into a log, Settings → Assistants →
  "Changed by an assistant", each with its item, its time and "Undo", which
  puts the item back as it was (a deleted one made again with all its
  properties, [foundation D7](foundation.md#D7)).
  - **Where**: in the store, on this device; it does not sync (an item's
    history is not iCalendar's), and it keeps the latest 500 changes.
  - **Only while nothing changed since.** An entry holds the item before
    and after. "Undo" is offered while the item is still what the assistant
    left (the same raw object: no edit by the user, no sync bringing
    another's); once it changed, the entry says "Changed since" and offers
    to open the item instead. Undo never overwrites a later edit.

## Deferred

- **A standalone MCP server** (stdio) for those with neither the desktop
  app nor AstroTime's server: its own store and sync engine, synced with
  the same CalDAV account as one more device ([D307](#D307)).
- **More language packs** beyond English and Russian ([D300](#D300)): one
  file each.
- **A language model for the quick parse** where rules fall short
  ([D300](#D300)).
- **Whisper on the desktop natively** (whisper.cpp in the main process)
  if the page's WASM is too slow there ([D303](#D303)).

## PR plan

Each PR is based on `main`.

### PR AS1 — This plan

The decisions above, design's D294–D299, the grilling's record, the
glossary's words, the library's routes.

Done when: `scripts/docs.test.ts` passes with the plan reachable from the
trailhead.

### PR AS2 — `parseQuick`

D300, D301. Started once design's quick create (PR L2) is merged: the
parser, the English and Russian packs, `chrono-node`, recorded lines in
both languages as tests, and its wiring into quick create.

Done when: with `now` Thursday 2026-11-05 10:00 in `Europe/Moscow` unless
a case names another, the tests read:

- «завтра в 13 обед с Машей в Кофемании 1 час» as an event, 2026-11-06
  13:00–14:00, place «Кофемании», title «обед с Машей», with the spans of
  «завтра в 13», «в Кофемании» and «1 час»;
- "call mom friday 5pm" as a task ("call" is a task word), 2026-11-06
  17:00, no length, title "call mom";
- «завтра купить хлеб» as an all-day task on 2026-11-06;
- «отпуск с 10 по 14 декабря» as an all-day event 2026-12-10 to 14
  (`DTEND` the 15th);
- «завтра в 9 стендап» with `now` 2026-11-05 23:30 in `America/New_York`
  (04:30 the next day in UTC) as 2026-11-06 09:00 there, not the 7th;
- «14 марта в 2:30 звонок» with `now` 2027-03-01 in `America/New_York`,
  a time that day's spring-forward skips, as 03:30, as the editor resolves
  it;

and quick create marks them as they are typed (e2e, both languages).

### PR AS3 — Voice

D302–D306. Settings → Voice, Whisper on this device, the server, Android's
recogniser.

Done when: a recorded clip through each recogniser (a fake server speaking
the OpenAI interface in tests) opens quick create filled; with Voice off no
microphone button is in the accessibility tree.

### PR AS4 — MCP in the desktop app

D307, D308, D310, D311.

Done when: an MCP client in tests lists, creates, changes and deletes an
item through the desktop app's endpoint, the store holds each change, sync
sends it, and "Undo" in the log puts it back; and a request with a missing
or wrong token, a foreign `Host` or any `Origin` is refused, and the old
token is refused after "New token".

### PR AS5 — MCP on AstroTime's server

D309. After server's PR S3.

Done when: a read-only token can list and is refused a create; a
read-write token's create is seen by a CalDAV client.
