"use client";

import { useRef, useState, type ChangeEvent, type ReactElement } from "react";
import { AlertTriangle, Download, FileJson, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Segmented } from "@/components/shared/primitives";
import type { CareerFile } from "@/lib/schema";
import { formatDate, todayIso } from "@/lib/stats";
import { actions, exportFile, parseImport, useAccount, useCareer } from "@/lib/store";
import { chronological } from "@/lib/engine/career";

const MAX_FILE_BYTES = 8 * 1024 * 1024;

function downloadJson(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function ImportPreview({ file, onDone }: { file: CareerFile; onDone: () => void }) {
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const ordered = chronological(file.matches);
  const first = ordered[0]?.date;
  const last = ordered.at(-1)?.date;

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-muted p-3 text-sm">
        <p className="font-semibold">
          {file.matches.length} {file.matches.length === 1 ? "match" : "matches"}
          {file.profile ? ` for ${file.profile.name}` : ""}
        </p>
        {first && last ? (
          <p className="mt-0.5 text-muted-foreground">
            {formatDate(first)} to {formatDate(last)}
          </p>
        ) : null}
      </div>
      <Segmented
        label="Import mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: "merge", label: "Merge" },
          { value: "replace", label: "Replace" },
        ]}
        className="flex"
      />
      <p className="text-sm text-muted-foreground">
        {mode === "merge"
          ? "Adds new matches and skips any you already have. Your profile stays the same."
          : "Replaces every match and your profile with this file. This can't be undone, so export first if you're unsure."}
      </p>
      <Button
        variant="cta"
        className="w-full"
        onClick={() => {
          const { added, skipped } = actions.importCareer(file, mode);
          toast.success(`${added} ${added === 1 ? "match" : "matches"} imported`, {
            description: skipped ? `${skipped} already in your career were skipped.` : "Your career has been recalculated.",
          });
          onDone();
        }}
      >
        {mode === "merge" ? "Merge into career" : "Replace career"}
      </Button>
    </div>
  );
}

export function DataDialog({ trigger }: { trigger: ReactElement }) {
  const { profile, matches } = useCareer();
  const signedIn = useAccount().status === "signed-in";
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<CareerFile | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  function reset() {
    setPending(null);
    setProblems([]);
    if (input.current) input.current.value = "";
  }

  function onExport() {
    downloadJson(exportFile({ profile, matches }), `irl-career-mode-${todayIso()}.json`);
    toast.success("Career exported", { description: `${matches.length} matches saved to your downloads.` });
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPending(null);
    setProblems([]);
    if (file.size > MAX_FILE_BYTES) {
      setProblems(["That file is over 8 MB, which is too large for a career export."]);
      return;
    }
    const parsed = parseImport(await file.text());
    if (parsed.ok) setPending(parsed.file);
    else setProblems(parsed.problems);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="heading text-xl">Your data</DialogTitle>
          <DialogDescription>
            {signedIn
              ? "Your career syncs to your account. Export a JSON backup any time, or import a career file."
              : "Everything lives in this browser. Export a JSON backup, or bring a career in from another device."}
          </DialogDescription>
        </DialogHeader>

        {pending ? (
          <ImportPreview
            file={pending}
            onDone={() => {
              reset();
              setOpen(false);
            }}
          />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" size="lg" onClick={onExport} data-icon="inline-start">
              <Download />
              Export JSON
            </Button>
            <Button variant="outline" size="lg" onClick={() => input.current?.click()} data-icon="inline-start">
              <Upload />
              Import JSON
            </Button>
            <input
              ref={input}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              tabIndex={-1}
              aria-label="Career JSON file"
              onChange={onFile}
            />
          </div>
        )}

        {problems.length ? (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <p className="flex items-center gap-2 font-semibold text-destructive">
              <AlertTriangle className="size-4" />
              This file can&apos;t be imported
            </p>
            <ul className="mt-2 space-y-1 text-foreground/85">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileJson className="size-3.5" />
          {matches.length} {matches.length === 1 ? "match" : "matches"} currently stored
        </p>
      </DialogContent>
    </Dialog>
  );
}
