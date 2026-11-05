# Server and mesh plan

Status: **in progress** — the three ways to sync are decided; AstroTime's
own CalDAV server ([PR S2](#pr-s2--astrotimeserver)) is built, not yet in
the image. This plan owns AstroTime working with no other software: its
own server that every client syncs with, and a mesh of AstroTime peers
that sync with each other. It builds on foundation's
[D4](foundation.md#D4) (providers behind one interface),
[D5](foundation.md#D5) (the store is the UI's truth, only the sync engine
talks to servers), [D7](foundation.md#D7) (nothing lost),
[D40](foundation.md#D40) (one small image) and [D123](foundation.md#D123)
(a single-user deployment's preset). Its decisions are D278–D293.

## Goal

The owner, 2026-11-05: "If you just want to use this app and no other,
there is no way. Make a server mode, so phone and computer connect to one
server and it is one app. So there are two modes: every client connects to
a third-party server, or our own server is that server. And a third: a
mesh, where every active calendar gets updates from the others; if one
client goes down and another comes up while a third was connected all
along, all of them have the same data."

So: AstroTime syncs in one of three ways, and a user who wants AstroTime
alone needs nothing else.

## Decisions

- **D278. Three ways to sync.** An account syncs (1) with a third-party
  server, as today (Nextcloud, Google, any CalDAV server); (2) with
  **AstroTime's own server**, the web image in server mode
  ([D281](#D281)); or (3) in a **mesh** of AstroTime peers with no server
  at all ([D283](#D283)). The three live side by side: one device can hold
  a Nextcloud account, an account on an AstroTime server and a mesh.

### AstroTime's own server

- **D279. AstroTime's server speaks CalDAV.** Not a protocol of its own:
  the CalDAV provider, the sync engine, its conflicts
  ([D6](foundation.md#D6)) and its request budget
  ([D126](foundation.md#D126)) work against it unchanged, nothing outside
  the providers learns a new protocol ([D4](foundation.md#D4)), and other
  clients (Thunderbird, DAVx⁵, Apple Calendar, GNOME) sync with it too.
  _Alternative:_ a JSON protocol shaped after the store; rejected, it would
  be a second provider to keep and would lock other clients out.

- **D280. `@astrotime/server`: the CalDAV server.** A Node package, not
  isomorphic (only the image runs it), whose handler is a
  `(Request) => Promise<Response>` like `proxyHandler`, over a `SqlDriver`
  (`@astrotime/storage/node`) with a schema of its own: users, calendars,
  objects and a change log. It serves the subset AstroTime and the common
  clients use:
  - discovery: `/.well-known/caldav` redirects to the root; `PROPFIND`
    answers `current-user-principal`, `calendar-home-set`,
    `principal-URL`, `resourcetype`, `displayname`, Apple's
    `calendar-color`, `supported-calendar-component-set`, `getctag`,
    `sync-token`, `getetag`, `getcontenttype`, `owner` and
    `current-user-privilege-set`, Depth 0 and 1;
  - `REPORT`: `calendar-multiget`, `calendar-query` (component filter and
    time range, the range through `occurrencesBetween`), and
    `sync-collection` (RFC 6578: a token is the calendar's change number,
    removed objects as `404`, an unknown token `403 valid-sync-token`);
  - `GET`, `PUT` (`If-Match`, `If-None-Match: *`, `412` on a mismatch,
    one UID per resource and per calendar, `no-uid-conflict`), `DELETE`
    (`If-Match`), `MKCALENDAR`, `PROPPATCH` (name and colour), `OPTIONS`
    (`DAV: 1, 3, calendar-access, extended-mkcol`).
    An object is stored as its client sent it, byte for byte; its ETag is a
    hash of those bytes ([D7](foundation.md#D7)). Paths:
    `/dav/principals/<user>/`, `/dav/calendars/<user>/<calendar>/<object>.ics`.
  - How it reads the rest (PR S2): a sync token is
    `urn:astrotime:sync:<calendar id>:<change number>`, the calendar's
    `getctag` the same, and a calendar's id is never reused, so a token of
    a removed calendar is unknown to its successor; `Depth: infinity` (or
    none) is answered as 1, as SabreDAV does; `calendar-query` reads the
    component and its time range, a date or floating time in UTC, and
    answers a property filter's superset; `MKCALENDAR` and `MKCOL` with
    the calendar resourcetype (RFC 5689, DAVx⁵'s) keep the name, the
    colour and `VEVENT`/`VTODO` of the component set, and drop the rest
    (a description, a time zone); `PROPPATCH` of anything else refuses the
    whole update (`403`, the others `424`); a second resource with one UID
    is `403 no-uid-conflict`; `DELETE` of a calendar removes it with its
    objects; a body over 10 MiB is `413`; a path segment with an encoded
    slash is `400`; a VTODO with neither `DTSTART` nor `DUE` is placed by
    `COMPLETED` and `CREATED` (RFC 4791 §9.9); an object core cannot expand
    matches any range, more than asked rather than hidden.

- **D281. Server mode is the web image with a data directory.**
  `ASTROTIME_SERVER_DATA` (the image's volume, `/data`) turns it on; the
  server mounts the handler under `/dav/` on the app's own origin, keeps
  `server.sqlite` there, and presets the sign-in to its own `/dav/`
  ([D123](foundation.md#D123)): the page reaches its own origin directly,
  no proxy between. Off, the image is as before. This amends
  [D40](foundation.md#D40) (the image keeps state: the volume) and
  [D123](foundation.md#D123) (the preset may name the image's own
  `/dav/`); both carry a note pointing here.

- **D282. Users and passwords.** Users live in the server's database,
  passwords hashed with scrypt (`node:crypto`, N=2¹⁵, r=8, p=1, 16-byte
  salt). `astrotime-server user add|passwd|remove <name>` in the image
  manages them; `ASTROTIME_SERVER_USER` with `ASTROTIME_SERVER_PASSWORD`
  makes the first user at start when there are none, so one `docker run`
  is enough. HTTP Basic over the reverse proxy's TLS, as Nextcloud's app
  passwords; ten failed sign-ins from one address in a minute answer
  `429` with `Retry-After` until the minute is over. Only a refused
  password is a failure, and a success forgives none; checks still running
  count against the limit, so guesses sent at once meet it too, while
  requests with one password share one check (one scrypt), and a password
  once checked is remembered by a hash of it until it changes. An unknown
  name costs a scrypt as a known one does. The handler is told the address
  by its caller (the image: the socket's); a caller that gives none gets
  no limit rather than one bucket that locks every user out. A new user gets a
  calendar ("Personal") and a task list ("Tasks"). Each user sees only
  their own calendars; sharing between users is
  [deferred](#deferred).

### The mesh

- **D283. A mesh: peers that sync with each other.** A mesh is a set of
  AstroTime **peers** (a browser, a phone, a desktop, a server image) that
  share a set of calendars. Every peer holds all of them in its own store;
  no peer is primary. A change made on one reaches every peer connected to
  it, and every peer connected to those (a **relay**), so peers that were
  never online at the same time converge through one that was. On each
  peer, the mesh is an account of provider `mesh`; its calendars are the
  mesh's calendars, read and written as any other
  ([D5](foundation.md#D5)).

- **D284. Versions, and the newest wins.** Every change to a mesh
  calendar or item is a **version**: its content (the calendar object's
  text as written, or a tombstone for a deletion), a hybrid logical clock
  timestamp (HLC: wall-clock milliseconds, a counter, the peer's id), and
  the peer's own sequence number for it. A peer keeps, per item, only its
  current version, and a **version vector**: per peer, the highest
  sequence number whose version it has applied or seen superseded. Two
  versions of one item are ordered by HLC, the peer id breaking a tie, so
  every peer picks the same winner and the mesh converges whatever order
  versions arrive in. Tombstones are kept (an item's id and its version,
  a few bytes); collecting them is [deferred](#deferred). Calendars
  (name, colour, components) are versioned the same way.
  A clock that runs ahead would win every conflict, so the handshake
  carries each side's wall clock, and a peer more than five minutes off
  is refused with the reason said ("this device's clock is off"), as
  Kerberos and TOTP bound drift; a version stamped more than five minutes
  ahead of the receiver's clock closes the connection the same way.
  _Why last-writer-wins:_ CouchDB's and Syncthing's choice for documents
  edited on devices offline: deterministic, no coordinator. Two offline
  edits of one item to different fields keep only the newer; a field
  merge is [deferred](#deferred).

- **D285. Anti-entropy, then live pushes.** When two peers connect, each
  sends its version vector; each answers with every current version the
  other's vector does not cover, in one batch the receiver applies in one
  transaction before it takes the sender's vector into its own (the
  element-wise maximum). After that, a peer pushes each new version (its
  own, or one it applied from another peer) to every other connected peer
  whose vector does not cover it. A peer that was down catches up at its
  next connection from any peer, and that is the relay of
  [D283](#D283).

- **D286. Transport: WebSocket, end-to-end encrypted.** Peers exchange
  JSON messages over WebSocket (subprotocol `astrotime-mesh.1`). A peer
  that can listen does: the server image (`/mesh` on its own origin, in
  server mode or not), and the desktop app on the local network (off by
  default, a port in Settings). A browser and the Android app only dial
  out. A peer dials every listening address it knows and keeps the
  connection while it runs, redialling with backoff; peers tell each
  other the listening addresses they know, so a new peer learns the
  whole mesh from one. Every message after the handshake is sealed with
  AES-GCM under a key derived (HKDF-SHA-256) from the mesh secret and
  both sides' nonces, so a plain `ws://` on a home network shows nothing.
  All through WebCrypto, so it runs unchanged in every shell
  ([Architecture rule 1](../../AGENTS.md#architecture-rules)).
  WebRTC between two dial-only peers is [deferred](#deferred).

- **D287. Joining a mesh: an invite.** A mesh has an id and a 32-byte
  secret, made by the peer that creates it. Its **invite** is
  `astrotime-mesh:<mesh id>.<secret, base64url>@<listening address>,…`,
  shown as text and a QR code on any peer of the mesh; entering it on
  another device joins it. A connection proves both sides know the secret
  by HMAC-SHA-256 over each other's random challenge before anything
  else is sent; a wrong one is closed. The secret is kept in the
  platform's `SecretStore`, never in the store. Removing a peer from a
  mesh means a new secret for the rest ([deferred](#deferred)).

- **D288. Where the mesh lives.** `@astrotime/mesh` (isomorphic): the
  HLC, versions, vectors, the replica's rules, the protocol and its
  handshake, behind a `MeshStore` (where a peer keeps versions and its
  vector) and a `MeshTransport` (how messages travel; an in-memory one
  for tests). `@astrotime/storage` implements `MeshStore` on its own
  tables (a migration); a change made on this device to a mesh calendar
  becomes a version at once instead of waiting as pending. The UI and
  shells start a `MeshNode` per mesh account next to `syncAll`, which
  leaves mesh accounts alone. The server image's listener keeps its peer
  in a node store under the data directory.

- **D289. The mesh in the UI.** The account dialog's "Add account" offers
  "Mesh of your devices": **create** one (this device becomes its first
  peer and shows the invite) or **join** one (paste or scan an invite).
  The mesh account's row says how many peers are connected now and
  offers the invite again. English and Russian, as every string.

- **D290. Proof of the mesh.** In `@astrotime/mesh`'s tests, over the
  in-memory transport, with no timeouts (a test waits for the transport
  to fall quiet: no message in flight): the owner's scenario (A, B and C;
  C always up; A edits and goes down; B comes up and has A's edit from
  C); concurrent edits of one item converge on every peer to one
  version, the peer id breaking an HLC tie; a deletion against an edit
  and a calendar's rename on two peers converge the same way; a peer
  whose clock is off by more than five minutes is refused; a seeded random run of five peers through random partitions
  and edits ends with every store equal.

- **D291. Proof of the server.** `@astrotime/server`'s tests drive it
  with the CalDAV provider and `syncAccount` exactly as the Radicale run
  does (`packages/sync/test/servers.test.ts`), the request budget
  included, plus a recorded Thunderbird-style and DAVx⁵-style session
  per D279's other clients. The provider and engine half runs in
  `@astrotime/sync`'s own files, the server one more entry beside Radicale
  (`startAstroTime`), so every test there holds for it and the packages
  depend one way; the clients' sessions are `@astrotime/server`'s.

- **D292. One mesh peer per device and mesh.** A device joins a mesh
  once; a second invite of the same mesh id is the same account. A
  device can be in several meshes, each its own account.

- **D293. The mesh protocol in detail.** What PR M1 settled inside
  [D284](#D284)–[D287](#D287):
  - **A vector counts only what has no gap.** A version is applied
    whatever order it arrives in, but its author's count moves to it only
    when every earlier one is covered; one that came out of order (through
    two relays) is counted at the next anti-entropy, whose answer resends
    it. So a vector never claims a version its peer lacks.
    The cost is accepted: a batch carries only current versions, so gaps
    in an author's sequence are normal there and close only through the
    sender's vector, and a push that follows a gap waits for the next
    anti-entropy to be counted; until then a hello reports less than this
    replica holds, and the other side resends versions it already has.
    Convergent, and bounded by one connection's pushes.
  - **Only what changed something is passed on**: a version that won, or
    one newly counted. A duplicate, or one older than what a peer has
    and already counted, stops there, so pushes end in a mesh with cycles.
  - **A change is stamped after its item's current version** (the clock
    observes it first), so an edit made after a restart, with a wall clock
    behind, still wins over the version it replaced.
  - **The handshake is symmetric.** Each side sends `challenge` (protocol,
    mesh id, peer id, a 32-byte nonce, its wall clock) on open; a mesh id
    not its own, or a clock more than five minutes off its own
    ([D284](#D284)), closes the connection there, after a `refusal` frame
    with the reason (`clock` or `refused`) so the other side can say it
    too (`MeshNode`'s `onRefused`). Each answers with `proof`,
    HMAC-SHA-256 over `["proof", protocol, mesh id, prover's peer id,
    nonce and clock, verifier's peer id, nonce and clock]`. Each
    direction has its own AES-GCM key, HKDF with the sender's nonce then
    the receiver's as salt; its IV counts that
    direction's messages, so a frame tampered with, replayed, dropped or
    reordered does not open and closes the connection.
  - **Messages**: `hello` (vector, addresses), `batch` (the versions the
    hello's vector does not cover, and the vector they were taken with),
    `push` (one version), `addresses` (learnt since). A peer's batch is
    taken and queued under one lock with its applies, so every version
    reaches the other side in the batch or as a push after it.
  - **Two connections with one peer** (two listeners dialling each other):
    both keep the one dialled by the smaller peer id.
  - **Redial**: every dial that fails and every connection that closes
    is dialled again after a wait: 1 s, doubled per failure up to a
    minute. The count starts over only after a connection that served a
    batch and stayed up a minute, so a peer that drops each connection
    (crashing once connected, even after its batch) is never dialled in
    a loop. Only a `refusal` frame, sent or received in the handshake, is
    a refusal (`onRefused`): it is in the clear, so one after the
    handshake closes the connection with no reason, and a bare close in
    the handshake is a drop. A version stamped ahead closes with `ahead`,
    not `clock`: the clock at fault may be the other peer's. An address that answers with this
    very peer is never dialled again.
  - **Keys**: the secret is only HKDF's root; the proofs' HMAC key and
    each direction's AES-GCM key are derived from it with labels of their
    own (`astrotime-mesh.1 proof`, `astrotime-mesh.1 seal`).
  - **A version from the future stays a refusal.** A version stamped more
    than five minutes ahead (a device's own clock set wrong when it made
    it) is refused by every receiver, and each anti-entropy batch with it
    closes that connection with `clock` until real time catches up; the
    UI's "this device's clock is off" can then blame a device whose clock
    is right now. Rare, bounded by the drift itself; capping what a peer
    stamps, or quarantining such a version instead, is
    [deferred](#deferred).
  - **The seams for PR M2**: `MeshStore` is one transaction (`vector`,
    `setVector`, `current`, `put`, `notCoveredBy`) plus the known
    addresses, so `@astrotime/storage` applies a batch in one SQLite
    transaction; `MeshTransport.dial` and `MeshNode.accept` take a
    connection of ordered text frames, a WebSocket's. A session handles
    its frames one at a time whatever the transport does: a transport may
    hand over the next frame before the last one's promise settles.

## Deferred

- Sharing a calendar between users of one AstroTime server.
- The desktop app as an AstroTime server (CalDAV on the local network);
  the mesh covers phone and computer without one.
- WebRTC between two dial-only peers (two browsers, two phones) with a
  listening peer as the signalling path.
- Field-level merge of two offline edits of one mesh item ([D284](#D284)).
- Collecting mesh tombstones once every known peer has seen them.
- Removing a peer from a mesh: a new secret handed to the rest
  ([D287](#D287)).
- Finding peers on the local network (mDNS) instead of typing an address.
- A version stamped ahead in a peer's store: cap what it stamps, or
  quarantine it, instead of every connection refusing it ([D293](#D293)).
- Bounding a vector a peer sends: one inflated entry (a bug, a backup
  restored with its peer id) makes a replica skip that author's real
  versions for good. Accepted for now, as every peer holds the secret
  ([D293](#D293)).
- Limits on a mesh frame, a batch and an address list (a batch could be
  chunked, a gossiped address checked as a URL); within a mesh whose
  peers all hold the secret ([D293](#D293)). Before the handshake a frame
  over 1 KiB is already refused unread.
- On AstroTime's server ([D280](#D280)): dead properties (a calendar's
  description and time zone, any client's own), `calendar-query`'s
  property filters and partial `calendar-data` (`comp`, `expand`),
  free-busy and scheduling (RFC 6638); a ceiling on scrypt work across
  addresses (many addresses, or a caller that gives none, each pay a
  hash per new guess); pruning the change log, which
  keeps a row per object name a calendar ever held (a removed one's too),
  and answering a token older than the pruning `403 valid-sync-token`.

## PR plan

### PR S1 — This plan

The decisions above, the glossary's words, the library's route.

Done when: `scripts/docs.test.ts` passes with the plan reachable from
the trailhead, and D40 and D123 point here.

### PR S2 — `@astrotime/server`

D279, D280, D282 (the database half), D291. The package, its schema, its
handler and its tests; its line in `docs/map.md`.

Done when: the CalDAV provider and `syncAccount` pass D291's run against
it, within the request budget, and an `X-` property written by one
client comes back byte for byte.

### PR S3 — Server mode in the image

D281, D282 (the command and the first user). After S2. `apps/proxy`
mounts the server under `/dav/` (and `/.well-known/caldav`) when
`ASTROTIME_SERVER_DATA` is set (a `401` to the page must not bring up
the browser's own password dialog, as the proxy's never does, while
Thunderbird and DAVx⁵ need its `WWW-Authenticate`), the
image's volume, the preset to its own origin, README's self-hosting
section, an e2e run where the web app signs in to its own server.

Done when: one `docker run` with a volume and a first user serves the app
and `/dav/`; e2e signs in there, makes an event, and a second browser
context sees it after its sync.

### PR M1 — `@astrotime/mesh`

D283–D287 (the protocol half), D290, D293. HLC, versions, vectors, the
replica, the handshake and sealing, the in-memory transport, the
convergence tests; its line in `docs/map.md`.

Done when: every test of D290 passes over the in-memory transport, with
no timeout in any of them.

### PR M2 — The mesh in the store and the shells

D288. After M1. The storage migration and `MeshStore` over `Store`, a
local change to a mesh calendar as a version, the WebSocket transport,
`MeshNode` started by the UI for every mesh account and the secret in
`SecretStore`.

Done when: two stores on the node driver, joined by the WebSocket
transport, converge on D290's scenario, and an edit in the UI's store
reaches the other as a version.

### PR M3 — Listening peers

D286 (the listeners). After M2 and S3. The image's `/mesh` endpoint and
its peer's store, the desktop app's local-network listener and its
Settings switch.

Done when: a browser and the image's `/mesh`, and the desktop's listener
and a second store, converge on an edit made while the other was down.

### PR M4 — The mesh in the UI

D289, D292. After M2. Create and join, the invite as text and QR, the
mesh account's row, en and ru.

Done when: e2e in two browser contexts creates a mesh on one, joins it
on the other by the invite, and sees an event made on one appear on the
other; screenshots on a phone and a wide screen, English and Russian.
