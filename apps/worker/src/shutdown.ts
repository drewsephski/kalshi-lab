import type { EventEmitter } from "node:events";

/** Package managers can forward a terminal signal more than once. */
export function installShutdownHandlers(
  controller: AbortController,
  target: EventEmitter = process,
): () => void {
  const stop = () => controller.abort();
  target.on("SIGINT", stop);
  target.on("SIGTERM", stop);
  return () => {
    target.removeListener("SIGINT", stop);
    target.removeListener("SIGTERM", stop);
  };
}
