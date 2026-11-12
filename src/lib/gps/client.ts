"use client";

/**
 * The page's handle on GPS processing: a Web Worker when the browser has
 * one, the main thread otherwise. Requests are numbered so a slow, stale
 * result can never overwrite a newer one.
 */

import type { PitchCalibration } from "@/lib/gps/calibration";
import type { TrackingResult } from "@/lib/gps/pipeline";
import type { PlayingInterval } from "@/lib/gps/trim";
import type { ParsedFile, WorkerFailure, WorkerRequest, WorkerResponse } from "@/lib/gps/worker-protocol";

export class GpsTaskError extends Error {
  constructor(readonly failure: WorkerFailure) {
    super(failure.message);
    this.name = "GpsTaskError";
  }
}

type Pending = { resolve: (response: WorkerResponse) => void };
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export class GpsProcessor {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private next = 1;

  constructor() {
    if (typeof Worker === "undefined") return;
    try {
      this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const entry = this.pending.get(event.data.id);
        this.pending.delete(event.data.id);
        entry?.resolve(event.data);
      };
      this.worker.onerror = () => {
        // A worker that fails to start falls back to the main thread for every later call.
        this.worker?.terminate();
        this.worker = null;
        for (const [id, entry] of this.pending) {
          entry.resolve({ id, ok: false, error: { kind: "unexpected", title: "Processing stopped", message: "Processing stopped unexpectedly. Try again." } });
        }
        this.pending.clear();
      };
    } catch {
      this.worker = null;
    }
  }

  private async send(request: DistributiveOmit<WorkerRequest, "id">, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const id = this.next++;
    const message = { ...request, id } as WorkerRequest;
    if (!this.worker) {
      const { handleRequest } = await import("@/lib/gps/worker-protocol");
      return handleRequest(message);
    }
    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      this.worker!.postMessage(message, transfer);
    });
  }

  async parse(bytes: Uint8Array): Promise<ParsedFile> {
    // Send a copy: the caller keeps its bytes for upload later.
    const copy = bytes.slice().buffer;
    const response = await this.send({ type: "parse", bytes: copy }, [copy]);
    if (!response.ok) throw new GpsTaskError(response.error);
    if (response.type !== "parse") throw new Error("Unexpected response");
    return response.parsed;
  }

  async process(session: string, intervals: PlayingInterval[], calibration: PitchCalibration): Promise<TrackingResult> {
    const response = await this.send({ type: "process", session, intervals, calibration });
    if (!response.ok) throw new GpsTaskError(response.error);
    if (response.type !== "process") throw new Error("Unexpected response");
    return response.result;
  }

  /** Stops the worker. Requests still running settle as cancelled, so nothing waits forever. */
  dispose() {
    this.worker?.terminate();
    this.worker = null;
    for (const [id, entry] of this.pending) {
      entry.resolve({ id, ok: false, error: { kind: "unexpected", code: "cancelled", title: "Cancelled", message: "Processing was cancelled." } });
    }
    this.pending.clear();
  }
}
