"use client";

import { useState } from "react";
import { CloudOff, Cloud, KeyRound, LogOut, MonitorSmartphone, RefreshCw, ShieldCheck, Trash2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { AuthForm, NewPasswordForm } from "@/components/account/auth-form";
import { importGuestCareerWithToast } from "@/components/account/guest-import-dialog";
import { SyncDot, lastSyncedLabel, syncLabel } from "@/components/account/sync-status";
import { PageHeader, Reveal, SectionTitle } from "@/components/shared/primitives";
import { deleteAccount, signOut } from "@/lib/auth";
import { supabaseBackend } from "@/lib/gps/backends/supabase";
import { deleteAllGpsData } from "@/lib/gps/service";
import { actions, useAccount, useCareer, type AccountSnapshot } from "@/lib/store";

const BENEFITS = [
  { icon: MonitorSmartphone, title: "Every device", body: "Log on your phone after the game, review on your laptop." },
  { icon: Cloud, title: "Backed up", body: "Clearing your browser no longer wipes your career." },
  { icon: ShieldCheck, title: "Yours only", body: "Row-level security means only you can read your matches." },
];

function SetupSteps({ error }: { error: string | null }) {
  const steps = [
    <>Create a free project at <a className="text-primary underline-offset-4 hover:underline" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">supabase.com</a>.</>,
    <>Open <b>SQL Editor</b>, paste <code>supabase/migrations/20261105120000_accounts.sql</code> from this project, and run it.</>,
    <>In <b>Project Settings → API Keys</b>, copy the project URL and the <b>publishable</b> key.</>,
    <>Copy <code>.env.example</code> to <code>.env.local</code> and paste them in, then restart <code>npm run dev</code>.</>,
  ];
  return (
    <section className="panel max-w-2xl p-card sm:p-7">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-accent text-foreground">
          <KeyRound className="size-5" />
        </span>
        <h2 className="heading text-xl">Accounts aren&apos;t switched on yet</h2>
      </div>
      <p className="mt-3 text-muted-foreground">
        Your career works fully in this browser without one. To add sign-in and syncing, connect a Supabase project:
      </p>
      {error ? (
        <p role="alert" className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          The Supabase settings in <code>.env.local</code> couldn&apos;t be used: {error}
        </p>
      ) : null}
      <ol className="mt-5 space-y-3 text-sm [&_code]:rounded-sm [&_code]:bg-accent [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs [&_code]:break-all">
        {steps.map((step, index) => (
          <li key={index} className="flex gap-3">
            <span className="stat text-sm leading-5 font-bold text-primary">{String(index + 1).padStart(2, "0")}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <p className="mt-5 text-sm text-muted-foreground">The README has the full walkthrough, including the email settings.</p>
    </section>
  );
}

function SignedOut() {
  return (
    <div className="brand-pattern brand-feature grid items-start gap-8 overflow-hidden rounded-2xl border border-border p-card sm:p-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-12">
      <div className="lg:py-2">
        <p className="max-w-md text-foreground/85">
          Sign in to sync your player, matches and pitch maps. Everything still works offline and syncs when you reconnect.
        </p>
        <ul className="mt-section grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          {BENEFITS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-3">
              <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <p className="font-semibold">{title}</p>
                <p className="text-sm text-foreground/70">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <section className="panel p-card sm:p-6">
        <AuthForm />
      </section>
    </div>
  );
}

function SyncPanel({ account }: { account: AccountSnapshot }) {
  const failed = account.sync === "error";
  return (
    <section className="panel p-card sm:p-6">
      <SectionTitle title="Sync" />
      <div className="flex items-center gap-3">
        {failed ? <CloudOff className="size-5 text-loss" /> : <Cloud className="size-5 text-primary" />}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-semibold" role="status">
            <SyncDot account={account} />
            {syncLabel(account)}
          </p>
          <p className="text-sm text-muted-foreground">{lastSyncedLabel(account.lastSyncedAt)}</p>
        </div>
        <Button variant="outline" size="sm" onClick={actions.retrySync} disabled={account.sync === "syncing"} data-icon="inline-start">
          <RefreshCw />
          Sync now
        </Button>
      </div>
      {account.syncError ? <p className="mt-3 text-sm text-muted-foreground">{account.syncError}</p> : null}
    </section>
  );
}

function SignedIn({ account }: { account: AccountSnapshot }) {
  const { matches } = useCareer();
  const [confirm, setConfirm] = useState<"sign-out" | "delete" | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const canImport = actions.hasGuestCareer();

  async function doSignOut() {
    setBusy(true);
    const result = await signOut();
    setBusy(false);
    setConfirm(null);
    if (result.ok) toast.success("Signed out", { description: "You're back to this browser's guest career." });
    else toast.error("Couldn't sign out", { description: result.message });
  }

  async function doDelete() {
    setBusy(true);
    // Database rows go with the login (cascade), but stored GPS files must be removed through Storage first.
    await deleteAllGpsData(supabaseBackend).catch(() => undefined);
    const result = await deleteAccount();
    setBusy(false);
    setConfirm(null);
    setTyped("");
    if (result.ok) toast.success("Account deleted", { description: "Your login and synced career were removed." });
    else toast.error("Couldn't delete your account", { description: result.message });
  }

  return (
    <div className="grid grid-cols-1 items-start gap-block lg:grid-cols-2">
      <section className="panel p-card sm:p-6">
        <SectionTitle title="Signed in" />
        <p className="truncate text-base font-semibold">{account.user?.email}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {matches.length} {matches.length === 1 ? "match" : "matches"} in this account
        </p>
        <Button
          variant="outline"
          className="mt-5"
          disabled={busy}
          onClick={() => (account.pending > 0 ? setConfirm("sign-out") : void doSignOut())}
          data-icon="inline-start"
        >
          <LogOut />
          Sign out
        </Button>
      </section>

      <SyncPanel account={account} />

      {canImport ? (
        <section className="panel p-card sm:p-6">
          <SectionTitle title="Guest career" />
          <p className="text-sm text-muted-foreground">
            This browser also has a career you logged without an account. Add its matches here. Duplicates are skipped and demo data is never copied.
          </p>
          <Button variant="outline" className="mt-4" onClick={importGuestCareerWithToast} data-icon="inline-start">
            <UploadCloud />
            Add guest career
          </Button>
        </section>
      ) : null}

      <section className="panel border-destructive/25 p-card sm:p-6">
        <SectionTitle title="Delete account" />
        <p className="text-sm text-muted-foreground">
          Permanently removes your login, every synced match and any GPS imports and files. Export a backup from Matches first if you want a copy.
        </p>
        <Button variant="destructive" className="mt-4" onClick={() => setConfirm("delete")} data-icon="inline-start">
          <Trash2 />
          Delete account
        </Button>
      </section>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirm(null);
            setTyped("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "delete" ? "Delete your account?" : "Sign out with unsynced changes?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "delete"
                ? `This permanently deletes ${account.user?.email} and its ${matches.length} synced matches from every device. It can't be undone.`
                : `${account.pending} ${account.pending === 1 ? "change hasn't" : "changes haven't"} reached the server yet and will be lost if you sign out now.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirm === "delete" ? (
            <div>
              <label htmlFor="confirm-delete" className="mb-1.5 block text-sm text-muted-foreground">
                Type <b className="text-foreground">DELETE</b> to confirm
              </label>
              <Input id="confirm-delete" value={typed} autoComplete="off" onChange={(event) => setTyped(event.target.value)} />
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {confirm === "delete" ? (
              <AlertDialogAction variant="destructive" disabled={typed !== "DELETE" || busy} onClick={() => void doDelete()}>
                Delete account
              </AlertDialogAction>
            ) : (
              <AlertDialogAction variant="destructive" disabled={busy} onClick={() => void doSignOut()}>
                Sign out anyway
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function AccountScreen() {
  const account = useAccount();
  const signedIn = account.status === "signed-in";

  return (
    <Reveal>
      <PageHeader
        eyebrow="Account"
        title={!account.configured || account.configError ? "Accounts" : signedIn ? "Your account" : "Take your career everywhere"}
        description={signedIn ? "Your career syncs to this account and stays usable offline." : undefined}
      />
      {!account.configured || account.configError ? (
        <SetupSteps error={account.configError} />
      ) : signedIn && account.recovering ? (
        <section className="panel max-w-md p-card sm:p-7">
          <NewPasswordForm />
        </section>
      ) : signedIn ? (
        <SignedIn account={account} />
      ) : (
        <SignedOut />
      )}
    </Reveal>
  );
}
