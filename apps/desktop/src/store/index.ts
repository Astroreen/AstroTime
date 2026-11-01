// The store's process (docs/plans/desktop.md#D73): an Electron utility
// process that owns the database file and runs the page's statements on the
// ports the main process hands it, so a long write blocks only itself.
import { nodeConnection } from "@astrotime/storage/node";
import { portServer, type Reply, type Request } from "@astrotime/storage/port";

/** What the main process says to the store's process; `connect` carries a page's port. */
export type StoreCommand = { readonly type: "connect" } | { readonly type: "close" };

const path = process.argv[2];

type Opened =
  | {
      readonly connection: ReturnType<typeof nodeConnection>;
      readonly server: ReturnType<typeof portServer>;
    }
  | { readonly failure: string };

/**
 * The database, or why it could not be opened: then every statement fails
 * with the reason, so the page says the store did not open instead of
 * waiting for it.
 */
const opened: Opened = (() => {
  try {
    if (!path) throw new Error("The store's process was started without its database.");
    const connection = nodeConnection(path);
    const server = portServer(connection, {
      // Stuck in a gone page's transaction: this process stops, and the main
      // process starts another, whose open rolls the journal back (D98).
      lost(error) {
        console.error(error);
        process.exit(1);
      },
    });
    return { connection, server };
  } catch (error) {
    console.error(error);
    return { failure: error instanceof Error ? error.message : String(error) };
  }
})();

process.parentPort.on("message", ({ data, ports }) => {
  const command = data as StoreCommand;
  if (command.type === "close") {
    if ("server" in opened) {
      opened.server.close();
      opened.connection.close();
    }
    process.exit(0);
  }
  for (const port of ports) {
    const send = (reply: Reply) => port.postMessage(reply);
    if ("failure" in opened) {
      const { failure } = opened;
      port.on("message", ({ data: request }: { data: Request }) =>
        send({ type: "result", id: request.id, transaction: false, error: failure }),
      );
    } else {
      const page = opened.server.connect(send);
      port.on("message", ({ data: request }: { data: Request }) => page.receive(request));
      // The page reloaded, or its window went.
      port.on("close", () => page.gone());
    }
    port.start();
  }
});
