// The user's own pictures (docs/plans/design.md#D222): kept on this device,
// in the page's IndexedDB (`astrotime-pictures`), never in the calendars and
// never sent anywhere. A picture is made smaller as it is added (its long
// side at most 1600 px, WebP where the browser writes it, else JPEG; kept as
// it came where the browser has no canvas to draw it on), so a
// phone's photo of several megabytes keeps a few hundred kilobytes. The
// settings hold only each picture's id (`Settings.ownWords`, `ownBanners`).
import { useEffect, useState } from "react";

const DB = "astrotime-pictures";
const STORE = "pictures";
/** The long side a picture is kept at, at most: a wide screen's banner. */
const LONG_SIDE = 1600;

/** A picture the browser could not read as one. */
export class NotAPictureError extends Error {
  constructor(cause: unknown) {
    super("The file is not a picture this browser reads", { cause });
    this.name = "NotAPictureError";
  }
}

let opening: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.addEventListener("upgradeneeded", () => request.result.createObjectStore(STORE));
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error(`${DB} did not open`)),
    );
  }).catch((error: unknown) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

async function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    transaction.addEventListener("complete", () => resolve(request.result));
    transaction.addEventListener("error", () => reject(transaction.error ?? request.error));
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("aborted")));
  });
}

/** A picture's size once its long side is at most `LONG_SIDE`. */
export function keptSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, LONG_SIDE / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** The picture made smaller, as WebP where the browser writes it, else JPEG. */
async function smaller(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file).catch(() => throughImage(file));
  } catch (error) {
    throw new NotAPictureError(error);
  }
  try {
    const { width, height } = keptSize(bitmap.width, bitmap.height);
    const canvas = canvasOf(width, height);
    const context = canvas?.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null
      | undefined;
    // No canvas to draw on (an old WebView): the picture is kept as it came.
    if (!canvas || !context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    const webp = await blobOf(canvas, "image/webp");
    return webp?.type === "image/webp" ? webp : ((await blobOf(canvas, "image/jpeg")) ?? file);
  } finally {
    bitmap.close();
  }
}

/** A canvas to draw on: off the page where the browser has one, else the page's own. */
function canvasOf(width: number, height: number): OffscreenCanvas | HTMLCanvasElement | null {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** The canvas as a picture of `type`, or `null` when the browser writes none. */
async function blobOf(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  type: string,
): Promise<Blob | null> {
  try {
    if ("convertToBlob" in canvas) return await canvas.convertToBlob({ type, quality: 0.85 });
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  } catch {
    return null;
  }
}

/**
 * A picture the browser decodes only as an image element: an SVG, which
 * `createImageBitmap` takes from no `Blob` in Chromium.
 */
async function throughImage(file: Blob): Promise<ImageBitmap> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return await createImageBitmap(image);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Keeps a picture the user chose; resolves with its id. Rejects with `NotAPictureError`. */
export async function addPicture(file: Blob): Promise<string> {
  const blob = await smaller(file);
  const id = crypto.randomUUID();
  await transact("readwrite", (store) => store.put(blob, id));
  return id;
}

/** A kept picture, if there is one by this id. */
export async function pictureOf(id: string): Promise<Blob | undefined> {
  return transact("readonly", (store) => store.get(id) as IDBRequest<Blob | undefined>);
}

/** Forgets a picture; one that is not kept is no error. */
export async function removePicture(id: string): Promise<void> {
  urls.get(id)?.then(
    (url) => url && URL.revokeObjectURL(url),
    () => {},
  );
  urls.delete(id);
  await transact("readwrite", (store) => store.delete(id));
}

/** Each picture's object URL, made once and kept while the page is open; a miss or a failure is asked again. */
const urls = new Map<string, Promise<string | null>>();
/** A kept picture's object URL, `null` when there is none (or it was removed while read). */
export const pictureUrl = (id: string): Promise<string | null> => urlOf(id);

const urlOf = (id: string) => {
  const known = urls.get(id);
  if (known) return known;
  const url: Promise<string | null> = pictureOf(id).then(
    // Removed while it was read (`urls` no longer holds this read): no URL is made.
    (blob) => (blob && urls.get(id) === url ? URL.createObjectURL(blob) : null),
    () => null,
  );
  urls.set(id, url);
  void url.then((found) => found === null && urls.get(id) === url && urls.delete(id));
  return url;
};

/** A kept picture's URL to draw it by; `null` while it is read, or when there is none. */
export function usePictureUrl(id: string | null): string | null {
  const [found, setFound] = useState<{ id: string | null; url: string | null }>({
    id: null,
    url: null,
  });
  useEffect(() => {
    if (id === null) return;
    let live = true;
    void urlOf(id).then((url) => live && setFound({ id, url }));
    return () => {
      live = false;
    };
  }, [id]);
  return found.id === id ? found.url : null;
}
