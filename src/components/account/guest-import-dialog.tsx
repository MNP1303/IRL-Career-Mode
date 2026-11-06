"use client";

import { toast } from "sonner";
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
import { actions, useAccount } from "@/lib/store";

export function importGuestCareerWithToast() {
  const { added, usedGuestProfile } = actions.importGuestCareer();
  toast.success(added ? `${added} ${added === 1 ? "match" : "matches"} added to your account` : "Career added to your account", {
    description: usedGuestProfile
      ? "Your player profile came across too. Everything now syncs."
      : "Your account's own profile was kept. Everything now syncs.",
  });
}

/** Asked once per account when this browser already holds a guest career. */
export function GuestImportDialog() {
  const account = useAccount();
  const offer = account.status === "signed-in" ? account.guestImport : null;

  return (
    <AlertDialog open={Boolean(offer)} onOpenChange={(open) => !open && actions.dismissGuestImport()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Bring your career with you?</AlertDialogTitle>
          <AlertDialogDescription>
            {offer?.matches
              ? `This browser has ${offer.matches} ${offer.matches === 1 ? "match" : "matches"} you logged without an account.`
              : "This browser has a player profile you set up without an account."}{" "}
            Add {offer?.matches === 1 ? "it" : "them"} to {account.user?.email} so {offer?.matches === 1 ? "it syncs" : "they sync"} everywhere. Demo
            data is never copied, and the guest copy stays in this browser.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep separate</AlertDialogCancel>
          <AlertDialogAction onClick={importGuestCareerWithToast}>Add to my account</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
