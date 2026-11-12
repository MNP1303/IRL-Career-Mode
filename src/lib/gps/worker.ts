/// <reference lib="webworker" />
/**
 * Runs parsing and processing off the main thread, so a large file never
 * freezes the page. The parsed activity stays here between requests; each
 * re-process (after a trim or calibration change) only sends the small
 * intervals and calibration objects.
 */

import { handleRequest, type WorkerRequest } from "@/lib/gps/worker-protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const response = await handleRequest(event.data);
  scope.postMessage(response);
});
