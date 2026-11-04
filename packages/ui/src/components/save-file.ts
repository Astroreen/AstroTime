// A file the user asked to keep, saved where the platform saves files
// (`Platform.saveFile`, Android's "Save to"), else downloaded by the
// browser (the web; the desktop, whose Electron asks where): an inline
// attachment (design D230), an exported calendar (import D274).
import type { Platform } from "../platform.ts";

/** What became of a file: written, turned away in the picker, or handed to the browser's download. */
export type Saved = "saved" | "cancelled" | "download";

/**
 * Saves `file`: through the platform where it saves files, else by a
 * download link attached to the page for its click; the link's URL is
 * pushed to `links`, for the caller to let go when it goes, so a download
 * that starts late still finds it. A download is only begun: the browser
 * (or Electron's dialog) has the last word.
 */
export async function saveFile(
  file: { readonly name: string; readonly type: string; readonly bytes: Uint8Array },
  platform: Platform,
  links: string[],
): Promise<Saved> {
  if (platform.saveFile) return (await platform.saveFile(file)) === false ? "cancelled" : "saved";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([file.bytes.slice()], { type: file.type }));
  link.download = file.name;
  link.hidden = true;
  links.push(link.href);
  document.body.append(link);
  link.click();
  link.remove();
  return "download";
}
