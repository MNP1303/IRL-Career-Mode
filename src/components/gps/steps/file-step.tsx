"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { FileUp, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEFAULT_LIMITS } from "@/lib/gps/errors";
import { ACCEPTED_EXTENSIONS } from "@/lib/gps/parse";
import type { WorkerFailure } from "@/lib/gps/worker-protocol";
import { cn } from "@/lib/utils";

export function FileStep({
  busy,
  error,
  onFile,
  manualHref,
}: {
  busy: boolean;
  error: WorkerFailure | null;
  onFile: (file: File) => void;
  manualHref?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const hintId = useId();
  const maxMb = Math.round(DEFAULT_LIMITS.maxBytes / 1024 / 1024);

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (file && !busy) onFile(file);
  }

  return (
    <div className="space-y-5">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center transition-colors",
          over ? "border-primary bg-primary/5" : "border-input",
        )}
      >
        <div className="mb-4 grid size-12 place-items-center rounded-full bg-accent [&_svg]:size-5">
          {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <FileUp aria-hidden />}
        </div>
        <p className="heading text-title">{busy ? "Reading your file…" : "Drop a GPS file here"}</p>
        <p id={hintId} className="mt-2 max-w-sm text-sm text-muted-foreground">
          GPX, TCX or FIT from your watch or phone, up to {maxMb} MB. Export it from Garmin Connect, Strava, Coros, Polar, Suunto or Apple Health
          exporters.
        </p>
        <input
          ref={input}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          className="sr-only"
          aria-describedby={hintId}
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onFile(file);
          }}
        />
        <Button className="mt-5" variant="secondary" disabled={busy} onClick={() => input.current?.click()} aria-describedby={hintId}>
          Choose a file
        </Button>
        <p className="sr-only" aria-live="polite">
          {busy ? "Reading the file." : ""}
        </p>
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/8 p-4">
          <p className="font-semibold text-destructive">{error.title}</p>
          <p className="mt-1 text-sm text-foreground/90">{error.message}</p>
          {manualHref ? (
            <p className="mt-2 text-sm text-muted-foreground">
              You can still{" "}
              <a href={manualHref} className="text-primary underline-offset-4 hover:underline">
                paint your zones by hand
              </a>
              .
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="flex gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          The file is read on this device. No account is needed to preview it, and nothing is saved until you attach it to a match in the last
          step. Only the file’s contents decide its format, not its name.
        </span>
      </p>
    </div>
  );
}
