// An item's description as Markdown (docs/plans/design.md#D207), drawn as
// React elements from `parseMarkdown`'s tree: nothing is read as HTML, and a
// link opens elsewhere, without the page that opened it.
import { useId, useMemo, type ReactNode } from "react";

import { CheckIcon } from "./icons.tsx";
import { parseMarkdown, type Block, type Inline, type ListItem } from "../calendar/markdown.ts";

export function Description({ text }: { text: string }) {
  const tree = useMemo(() => parseMarkdown(text), [text]);
  return <div className="flex flex-col gap-2 break-words">{tree.map(block)}</div>;
}

/** A heading's look by its level; its element is two levels down, under the dialog's title. */
const HEADINGS = ["text-title", "text-row font-semibold", "text-body font-semibold"] as const;

function block(node: Block, key: number): ReactNode {
  switch (node.type) {
    case "paragraph":
      return <p key={key}>{node.children.map(inline)}</p>;
    case "heading": {
      const Tag = `h${Math.min(6, node.level + 2)}` as "h3";
      return (
        <Tag key={key} className={HEADINGS[Math.min(node.level, 3) - 1]}>
          {node.children.map(inline)}
        </Tag>
      );
    }
    case "code":
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-lg bg-canvas p-3 font-mono text-small whitespace-pre"
        >
          <code>{node.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote
          key={key}
          className="flex flex-col gap-2 border-l-2 border-line pl-3 text-ink-muted"
        >
          {node.children.map(block)}
        </blockquote>
      );
    case "rule":
      return <hr key={key} className="border-line" />;
    case "list": {
      const tasks = node.items.every((item) => item.checked !== null);
      const look = tasks
        ? "flex flex-col gap-1"
        : `flex flex-col gap-1 pl-5 marker:text-ink-muted ${node.start === null ? "list-disc" : "list-decimal"}`;
      const items = node.items.map((item, index) => (
        <Item key={index} item={item} bulleted={!tasks} />
      ));
      return node.start === null ? (
        <ul key={key} className={look}>
          {items}
        </ul>
      ) : (
        <ol key={key} start={node.start} className={look}>
          {items}
        </ol>
      );
    }
  }
}

/**
 * A list's item; a checklist's with its box where a bullet would be, drawn
 * as it is written: read-only, not ticked here (the text stays the user's).
 */
function Item({ item, bulleted }: { item: ListItem; bulleted: boolean }) {
  const id = useId();
  const body = <div className="flex flex-col gap-1">{item.children.map(block)}</div>;
  if (item.checked === null) return <li>{body}</li>;
  return (
    <li className={`flex list-none items-start gap-2 ${bulleted ? "-ml-5" : ""}`}>
      <span
        role="checkbox"
        aria-checked={item.checked}
        aria-readonly="true"
        aria-labelledby={id}
        className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded ${item.checked ? "bg-accent text-on-accent" : "ring-1 ring-ink-muted ring-inset"}`}
      >
        {item.checked && <CheckIcon className="size-3.5" />}
      </span>
      <div
        id={id}
        className={`min-w-0 flex-1 ${item.checked ? "text-ink-muted line-through" : ""}`}
      >
        {body}
      </div>
    </li>
  );
}

function inline(node: Inline, key: number): ReactNode {
  if (typeof node === "string") return node;
  switch (node.type) {
    case "break":
      return <br key={key} />;
    case "code":
      return (
        <code key={key} className="rounded bg-canvas px-1 py-0.5 font-mono text-[0.9em]">
          {node.text}
        </code>
      );
    case "strong":
      return (
        <strong key={key} className="font-semibold">
          {node.children.map(inline)}
        </strong>
      );
    case "em":
      return <em key={key}>{node.children.map(inline)}</em>;
    case "del":
      return <del key={key}>{node.children.map(inline)}</del>;
    case "link":
      return (
        <a
          key={key}
          href={node.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline underline-offset-2"
        >
          {node.children.map(inline)}
        </a>
      );
  }
}
