# Grilling: the owner's list — 2026-11-06

The owner brought a list of five wishes and an agent walked them question by
question. Each question came with a recommended answer; the owner accepted,
changed or widened it. The decisions live in
[`../plans/assistant.md`](../plans/assistant.md) (D300–D311) and
[`../plans/design.md`](../plans/design.md) (D294–D299); this page records
how they were reached.

## The brief

1. Be able to change fonts.
2. Record a voice, then speech-to-text, pick out the keywords, and when an
   event or task is created it all fits itself in. A small model can run on
   the client offline, and if a shared server is connected the audio can
   go there.
3. Add an MCP server.
4. Better pictures for the months and the keywords.
5. A simpler UI for creating tasks and events.

## Round 1

| #   | Question                   | Answer                                                                                                                                                                  | Decision   |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Q1  | Order and plans            | a new assistant plan; fonts, creating and pictures in design; one PR each from `main`                                                                                   | —          |
| Q2  | What "change fonts" means  | **widened:** a few bundled fonts and the system's, a text size, and a live preview                                                                                      | D294, D295 |
| Q3  | A simpler create           | a quick create sheet as Google's, the full editor behind it; **widened:** the full editor made lighter too, "the fields and buttons make it look heavy"                 | D296, D297 |
| Q4  | Parsing a line into fields | a rule parser in core, for typed and spoken lines; **asked:** "can it be universal for other languages? the project is open"                                            | D300, D301 |
| Q5  | Where speech is recognised | **changed:** on the client, or on any other server, not only AstroTime's; the user picks the model on the server                                                        | D303, D304 |
| Q6  | Better pictures            | **changed:** more detailed — "a snowdrift floats above the ground, a gap between a hill and a field, you can see the shapes"; and Google's parallax as the page scrolls | D298, D299 |
| Q7  | What MCP is for            | an assistant reads and changes the calendars; its own package                                                                                                           | D307       |

## Round 2

| #   | Question                     | Answer                                                                                                                            | Decision |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Q8  | Other languages              | `chrono-node` for dates, a language pack of data per language                                                                     | D300     |
| Q9  | The speech server's protocol | OpenAI-compatible `/v1/audio/transcriptions`, the model from `/v1/models`                                                         | D304     |
| Q10 | Which recogniser when        | **changed:** "always let the user choose; a setting of its own"                                                                   | D302     |
| Q11 | After recognition            | quick create filled, nothing saved by itself                                                                                      | D306     |
| Q12 | A lighter editor             | **asked for a prototype** before deciding                                                                                         | D297     |
| Q13 | Which fonts                  | System and seven bundled, with Cyrillic, 85–130 %, the preview in Settings                                                        | D294     |
| Q14 | Parallax                     | a fallback where there are no scroll timelines, and in the cards                                                                  | D299     |
| Q15 | How to draw better           | SVG drawn again, each checked rendered; painted pictures deferred                                                                 | D298     |
| Q16 | What MCP reads and writes    | **asked:** "why can it not change the client's database directly? and a file?" — it can, in the desktop app; a page opens no port | D308     |

## Round 3

| #   | Question            | Answer                                                                                                                      | Decision   |
| --- | ------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Q17 | The voice setting   | Off, the device, the server, automatic                                                                                      | D302       |
| Q18 | The prototype       | **changed:** empty fields stay as light rows with icons, not chips; "More options" did not fit beside "Save"                | D296, D297 |
| Q19 | Where MCP runs      | the desktop app first, then the server; the standalone one deferred; **widened:** "support the other models and agents too" | D308–D310  |
| Q20 | Assistant's actions | deletion asked, a log with undo                                                                                             | D311       |

## Round 4

| #   | Question                 | Answer                                                                                                                                                                  | Decision   |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Q21 | The prototype, again     | **changed:** the calendar and the colour are two fields; quick create has no "More options" — the sheet expanded is the full editor, with what was understood filled in | D296, D297 |
| Q22 | Android's own recogniser | **changed:** the keyboard has a microphone already, so no button unless a recogniser is chosen; Android's own one offered                                               | D302, D305 |
| Q23 | The default              | Off everywhere                                                                                                                                                          | D302       |
