// What kind of JSON a file is (docs/plans/import.md#D266): Google Takeout's
// tasks, told by their own `kind`. Read by the import to choose a
// converter and by that converter to accept a file, so the two never
// disagree; small, so the converter stays in a chunk of its own.

/** Whether parsed JSON is Takeout's tasks: `tasks#taskLists`, one `tasks#taskList`, or a list of them. */
export function isTakeoutTasks(json: unknown): boolean {
  const kind = (value: unknown) =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as { kind?: unknown }).kind
      : undefined;
  if (Array.isArray(json))
    return json.length > 0 && json.every((list) => kind(list) === "tasks#taskList");
  return kind(json) === "tasks#taskLists" || kind(json) === "tasks#taskList";
}
