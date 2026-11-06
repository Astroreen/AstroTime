// The tools AstroTime offers an assistant over MCP (docs/plans/assistant.md#D307):
// each one's name, words for the model, input schema and hints. The schemas
// are Zod's, which the MCP SDK lists as JSON Schema and checks a call
// against; the store's side checks the same ones again (`run.ts`), so
// a call is checked wherever it is run.
import * as z from "zod";

/** A day, `2026-11-06`; or a day and a time on the wall clock, `2026-11-06T13:00`. */
const WHEN = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/;

const when = (what: string) =>
  z
    .string()
    .regex(WHEN, "A day (YYYY-MM-DD) or a day and a time (YYYY-MM-DDTHH:MM).")
    .describe(
      `${what}: a day (YYYY-MM-DD) for an all-day item, or a day and a wall-clock time (YYYY-MM-DDTHH:MM) in \`timeZone\`.`,
    );

const day = (what: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "A day (YYYY-MM-DD).")
    .describe(what);

const timeZone = z
  .string()
  .min(1)
  .describe("The IANA zone the times are in, `Europe/Moscow`; the user's own when left out.")
  .optional();

const id = z.string().min(1).describe("The item's id, from a list, a search or a create.");

const text = (what: string) => z.string().max(20_000).describe(what);

/** The most an attachment's content may be, in base64: about 1 MiB of file. */
export const MAX_ATTACHMENT_BASE64 = Math.ceil((1024 * 1024) / 3) * 4;

export const TOOLS = {
  list_calendars: {
    title: "List calendars",
    description:
      "Lists the user's calendars and task lists: each one's id, name, account, what it holds (events, tasks) and what the user may do in it.",
    input: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  search_items: {
    title: "Search events and tasks",
    description:
      "Finds events and tasks by words in their title, case and accents aside. Returns each one's id, kind, title and times.",
    input: z.object({
      text: z.string().min(1).max(200).describe("Words the title holds."),
      calendarIds: z
        .array(z.string())
        .optional()
        .describe("Only these calendars; all when left out."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("At most this many; 50 by default."),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  list_items: {
    title: "List events and tasks over days",
    description:
      "Lists what happens on a range of days in the user's zone: every occurrence of the events and dated tasks there, a repeating item's each time.",
    input: z.object({
      from: day("The first day, YYYY-MM-DD."),
      to: day("The last day, YYYY-MM-DD, itself included."),
      calendarIds: z
        .array(z.string())
        .optional()
        .describe("Only these calendars; all when left out."),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  get_item: {
    title: "Get an event or a task",
    description:
      "One event or task in full: its title, times, place, description, status, reminders' count, attachments and its calendar.",
    input: z.object({ id }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  create_event: {
    title: "Create an event",
    description:
      "Creates an event in a calendar that holds events. Without an end, a timed event lasts an hour and an all-day one its day.",
    input: z.object({
      calendarId: z.string().min(1).describe("The calendar's id, from list_calendars."),
      summary: text("The title."),
      start: when("When it starts"),
      end: when("When it ends; for an all-day event its last day, itself included").optional(),
      timeZone,
      location: text("Where, as text.").optional(),
      description: text("Notes, in Markdown.").optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  create_task: {
    title: "Create a task",
    description:
      "Creates a task in a calendar or list that holds tasks, with a due day or time or none.",
    input: z.object({
      calendarId: z.string().min(1).describe("The list's id, from list_calendars."),
      summary: text("The title."),
      due: when("When it is due").optional(),
      timeZone,
      description: text("Notes, in Markdown.").optional(),
      priority: z.number().int().min(1).max(9).optional().describe("1 (highest) to 9 (lowest)."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  change_item: {
    title: "Change an event or a task",
    description:
      "Changes the fields named and nothing else: every other property stays as it was. A repeating item changes as a whole series. Times move together: a new start alone keeps the length.",
    input: z.object({
      id,
      summary: text("The new title.").optional(),
      description: text("The new notes; empty removes them.").optional(),
      location: text("The new place; empty removes it.").optional(),
      start: when("The new start").optional(),
      end: when(
        "The new end (an event's; for an all-day one its last day, itself included) or due (a task's)",
      ).optional(),
      timeZone,
      priority: z
        .number()
        .int()
        .min(1)
        .max(9)
        .nullable()
        .optional()
        .describe("A task's, 1 to 9; null for none."),
      categories: z
        .array(z.string().max(200))
        .max(50)
        .optional()
        .describe("The tags, all of them."),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  complete_task: {
    title: "Complete a task",
    description: "Marks a task done, or not done again.",
    input: z.object({
      id,
      done: z.boolean().optional().describe("False marks it not done; true by default."),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  add_attachment: {
    title: "Attach a file",
    description:
      "Attaches a file to an event or a task, inside the item: its content in base64 (about 1 MiB at most), never a path.",
    input: z.object({
      id,
      name: z.string().min(1).max(255).describe("The file's name, `agenda.pdf`."),
      type: z.string().max(255).optional().describe("Its media type, `application/pdf`."),
      content: z.string().min(1).max(MAX_ATTACHMENT_BASE64).describe("The file's bytes in base64."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  delete_item: {
    title: "Delete an event or a task",
    description:
      "Deletes an event or a task, a repeating one with all its occurrences. The user can undo it in AstroTime's settings.",
    input: z.object({ id }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
} as const;

export type ToolName = keyof typeof TOOLS;
export type ToolInput<Name extends ToolName> = z.infer<(typeof TOOLS)[Name]["input"]>;

export const isToolName = (name: string): name is ToolName => Object.hasOwn(TOOLS, name);
