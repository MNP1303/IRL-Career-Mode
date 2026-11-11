"use client";

import { ScrollReveal } from "@/components/motion/scroll-reveal";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  ArrowUpDown,
  ImagePlus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DataDialog } from "@/components/data/data-dialog";
import { Field } from "@/components/match/form-controls";
import { AttributeRadar } from "@/components/player/attribute-radar";
import { PlayerCardStage } from "@/components/player/player-card-stage";
import { PositionPicker } from "@/components/pitch/position-picker";
import {
  CountUp,
  FillBar,
  Reveal,
  SectionTitle,
} from "@/components/shared/primitives";
import {
  ATTRIBUTES,
  ATTRIBUTE_KEYS,
  NATIONS,
  POSITION_META,
  nationName,
  type Position,
} from "@/lib/domain";
import { bestPositions } from "@/lib/engine/career";
import { RULES } from "@/lib/engine/rules";
import { LIMITS, profileSchema, type PlayerProfile } from "@/lib/schema";
import { actions, useAccount, useCareer } from "@/lib/store";
import { cn } from "@/lib/utils";

const PHOTO_SIZE = 480;

/** Crops to a square and shrinks it so it fits comfortably in localStorage. */
async function fileToPhoto(file: File) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_SIZE;
  canvas.height = PHOTO_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  const offsetX = (bitmap.width - side) / 2;
  // Portraits are cropped from near the top, where the face usually is.
  const offsetY = (bitmap.height - side) * 0.2;
  context.drawImage(
    bitmap,
    offsetX,
    offsetY,
    side,
    side,
    0,
    0,
    PHOTO_SIZE,
    PHOTO_SIZE,
  );
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

type Draft = Omit<PlayerProfile, "shirtNumber"> & { shirtNumber: string };

function ProfileEditor() {
  const { profile, career } = useCareer();
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft>({
    ...profile,
    shirtNumber: String(profile.shirtNumber),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  const shirtNumber = Number(draft.shirtNumber);
  const preview = {
    ...draft,
    name: draft.name || "Your name",
    shirtNumber: shirtNumber || 0,
  };
  const changed =
    JSON.stringify({ ...draft, shirtNumber }) !==
    JSON.stringify({ ...profile, shirtNumber: profile.shirtNumber });

  async function onPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrors((current) => ({ ...current, photo: "Choose an image file" }));
      return;
    }
    try {
      const photo = await fileToPhoto(file);
      set("photo", photo);
      setErrors((current) => ({ ...current, photo: "" }));
    } catch {
      setErrors((current) => ({
        ...current,
        photo: "That image couldn't be read. Try a JPG or PNG.",
      }));
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = profileSchema.safeParse({
      ...draft,
      shirtNumber: draft.shirtNumber === "" ? undefined : shirtNumber,
    });
    if (!parsed.success) {
      const issues: Record<string, string> = {};
      for (const issue of parsed.error.issues)
        issues[String(issue.path[0])] ??= issue.message;
      setErrors(issues);
      return;
    }
    setErrors({});
    actions.updateProfile(parsed.data);
    toast.success("Profile saved");
  }

  return (
    <div className="grid grid-cols-1 items-start gap-section lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-10">
      <div className="lg:sticky lg:top-24">
        <PlayerCardStage
          profile={preview}
          attributes={career.attributes}
          level={career.level.level}
          demo={profile.isSample}
          className="max-w-[240px] sm:max-w-[300px] lg:max-w-[320px]"
        />
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Previewing live as you edit
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="panel space-y-6 p-card">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            aria-label={
              draft.photo ? "Change profile picture" : "Add profile picture"
            }
            className="relative grid size-18 shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed border-input bg-muted text-muted-foreground transition-colors outline-none hover:border-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {draft.photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- local data URL
              <img
                src={draft.photo}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              <ImagePlus className="size-6" />
            )}
          </button>
          <div className="min-w-0">
            <p className="eyebrow text-foreground/85">Profile picture</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Stays in this browser. A head and shoulders shot works best.
            </p>
            {draft.photo ? (
              <button
                type="button"
                onClick={() => set("photo", null)}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" /> Remove
              </button>
            ) : null}
            {errors.photo ? (
              <p role="alert" className="mt-1 text-sm text-destructive">
                {errors.photo}
              </p>
            ) : null}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-label="Profile picture file"
            onChange={onPhoto}
          />
        </div>

        <div className="grid gap-x-4 gap-y-6 sm:grid-cols-[1fr_7rem]">
          <Field label="Name" htmlFor="name" error={errors.name}>
            <Input
              id="name"
              value={draft.name}
              maxLength={LIMITS.name}
              aria-invalid={Boolean(errors.name)}
              onChange={(event) => set("name", event.target.value)}
            />
          </Field>
          <Field label="Shirt" htmlFor="shirt" error={errors.shirtNumber}>
            <Input
              id="shirt"
              type="number"
              inputMode="numeric"
              min={1}
              max={LIMITS.shirtMax}
              value={draft.shirtNumber}
              aria-invalid={Boolean(errors.shirtNumber)}
              onChange={(event) => set("shirtNumber", event.target.value)}
            />
          </Field>
        </div>

        <Field label="Nationality" error={errors.nationality}>
          <Select
            value={draft.nationality}
            onValueChange={(value) => value && set("nationality", value)}
          >
            <SelectTrigger className="w-full" aria-label="Nationality">
              <SelectValue>{(value: string) => nationName(value)}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} className="max-h-72">
              {NATIONS.map((nation) => (
                <SelectItem key={nation.code} value={nation.code}>
                  {nation.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <p className="eyebrow text-foreground/85">Preferred positions</p>
            <p className="text-xs text-muted-foreground">
              Up to {LIMITS.preferredPositions}. The first sets your OVR.
            </p>
          </div>
          <div className="mx-auto max-w-[min(100%,46vh)] sm:max-w-none">
            <PositionPicker
              label="Pick your preferred positions"
              value={draft.positions}
              max={LIMITS.preferredPositions}
              onChange={(positions: Position[]) => set("positions", positions)}
            />
          </div>
          <ol className="mt-3 flex flex-wrap gap-1.5 text-xs font-medium">
            {draft.positions.map((position, index) => (
              <li key={position} className="rounded-sm bg-accent px-2 py-1.5">
                <span className="mr-1.5 text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                {POSITION_META[position].name}
              </li>
            ))}
          </ol>
        </div>

        <div className="flex justify-end">
          <Button
            type="submit"
            variant="cta"
            size="lg"
            disabled={!changed}
            data-icon="inline-start"
          >
            <Save />
            Save profile
          </Button>
        </div>
      </form>
    </div>
  );
}

function AttributeBreakdown() {
  const { career } = useCareer();
  const { baseline, lowDataBelow } = RULES.attributes;

  return (
    <ul className="space-y-4">
      {ATTRIBUTE_KEYS.map((key, index) => {
        const value = career.attributes[key];
        const rated = career.evidence[key];
        return (
          <li key={key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">
                {ATTRIBUTES[key].name}
              </span>
              <span className="flex items-baseline gap-3">
                <span
                  className={cn(
                    "text-xs",
                    rated < lowDataBelow
                      ? "text-loss"
                      : "text-muted-foreground",
                  )}
                >
                  {rated < lowDataBelow ? "Low data · " : ""}
                  {rated} rated
                </span>
                <CountUp
                  value={value}
                  decimals={1}
                  className="stat w-10 text-right text-stat-sm font-medium"
                />
              </span>
            </div>
            <div
              className="relative mt-2 h-[3px] rounded-full bg-foreground/10"
              aria-hidden
            >
              <FillBar value={value / 99} delay={0.15 + index * 0.06} />
              <span
                className="absolute -top-0.5 h-2.5 w-px bg-foreground/50"
                style={{ left: `${(baseline / 99) * 100}%` }}
              />
            </div>
          </li>
        );
      })}
      <li className="pt-1 text-xs text-muted-foreground">
        The tick marks your starting baseline of {baseline}.
      </li>
    </ul>
  );
}

function PositionFit() {
  const { career, profile } = useCareer();
  const preferred = (position: Position) =>
    profile.positions.includes(position) ? 0 : 1;
  const fits = bestPositions(career.attributes)
    .sort(
      (a, b) => b.ovr - a.ovr || preferred(a.position) - preferred(b.position),
    )
    .slice(0, 6);
  return (
    <ul className="grid grid-cols-3 gap-2">
      {fits.map(({ position, ovr }) => (
        <li
          key={position}
          className={cn(
            "rounded-lg border p-3 text-center",
            profile.positions.includes(position)
              ? "border-foreground/25 bg-accent/60"
              : "border-border",
          )}
        >
          <p className="stat text-stat">{ovr}</p>
          <p className="mt-1.5 font-display text-xs font-semibold tracking-wide text-muted-foreground">
            {position}
          </p>
        </li>
      ))}
    </ul>
  );
}

function DataManagement() {
  const { matches } = useCareer();
  const signedIn = useAccount().status === "signed-in";
  const [confirm, setConfirm] = useState<"reset" | "demo" | null>(null);

  return (
    <section className="panel p-card">
      <SectionTitle title="Data" />
      <p className="mb-4 text-sm text-muted-foreground">
        {signedIn
          ? "Your career syncs to your account, so it's safe if this browser's data is cleared."
          : "Your career is stored only in this browser. Sign in from the top bar to sync it, or export a backup."}
      </p>
      <div className="flex flex-wrap gap-2">
        <DataDialog
          trigger={
            <Button variant="outline" data-icon="inline-start">
              <ArrowUpDown />
              Import / export
            </Button>
          }
        />
        {signedIn ? null : (
          <Button
            variant="outline"
            onClick={() => setConfirm("demo")}
            data-icon="inline-start"
          >
            <RotateCcw />
            Load demo career
          </Button>
        )}
        <Button
          variant="destructive"
          onClick={() => setConfirm("reset")}
          data-icon="inline-start"
        >
          <Trash2 />
          Reset everything
        </Button>
      </div>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "demo"
                ? "Load the demo career?"
                : "Reset everything?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "demo"
                ? `This replaces your profile and ${matches.length} stored matches with sample data.`
                : signedIn
                  ? `This permanently deletes your profile and ${matches.length} matches from your account on every device.`
                  : `This permanently deletes your profile and ${matches.length} stored matches from this browser.`}{" "}
              It can&apos;t be undone, so export first if you want a copy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm === "reset" ? "destructive" : "default"}
              onClick={() => {
                if (confirm === "demo") actions.loadDemo();
                else actions.resetCareer();
                setConfirm(null);
                toast.success(
                  confirm === "demo" ? "Demo career loaded" : "Career reset",
                );
              }}
            >
              {confirm === "demo" ? "Load demo" : "Reset everything"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** The page opens on the player, not on a form: name, role and the numbers that define them. */
function PlayerIntro() {
  const { profile, career, matches } = useCareer();
  const position = profile.positions[0];
  const facts = [
    { label: "Overall", value: career.ovr },
    { label: "Level", value: career.level.level },
    { label: "Matches", value: matches.length },
    { label: "Badges", value: career.achievements.filter((entry) => entry.unlockedOn).length },
  ];
  return (
    <header className="mb-section grid gap-x-10 gap-y-6 border-b border-border pb-section lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div className="min-w-0">
        <p className="eyebrow flex items-center gap-2">
          <span className="h-0.5 w-4 bg-primary" aria-hidden />
          Player profile
        </p>
        <h1 className="display mt-3 text-hero break-words">{profile.name}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {POSITION_META[position].name} · #{profile.shirtNumber} · {nationName(profile.nationality)}
          <span className="text-faint"> · Your identity is yours to set. Your attributes have to be earned.</span>
        </p>
      </div>
      <dl className="grid grid-cols-4 gap-x-8">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt className="eyebrow">{fact.label}</dt>
            <dd className="stat mt-2 text-stat-lg">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}

export function PlayerScreen() {
  const { profile, career } = useCareer();
  return (
    <Reveal>
      <PlayerIntro />
      {/* Remounting keeps the draft in step when the profile is replaced by an import or reset. */}
      <ProfileEditor
        key={`${profile.name}-${profile.photo?.length ?? 0}-${profile.isSample}`}
      />

      <ScrollReveal className="mt-section">
        <div className="grid grid-cols-1 gap-block lg:grid-cols-2">
          <section className="panel p-card">
            <SectionTitle
              title="Attribute profile"
              aside={`OVR ${career.ovr}`}
            />
            <AttributeRadar attributes={career.attributes} />
          </section>
          <section className="panel p-card">
            <SectionTitle title="Evidence" />
            <AttributeBreakdown />
          </section>
          <section className="panel p-card">
            <SectionTitle title="Best positions" aside="OVR by role" />
            <PositionFit />
          </section>
          <DataManagement />
        </div>
      </ScrollReveal>
    </Reveal>
  );
}
