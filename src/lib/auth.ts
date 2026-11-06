"use client";

import { getSupabase } from "@/lib/supabase";

export type AuthResult = { ok: true } | { ok: false; message: string };

function requireClient() {
  const client = getSupabase();
  if (!client) throw new Error("Accounts aren't set up yet");
  return client;
}

/** Supabase's messages are written for developers; these are for players. */
function friendly(error: { message: string; code?: string; status?: number }) {
  const message = error.message.toLowerCase();
  if (error.code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "That email and password don't match.";
  }
  if (error.code === "email_not_confirmed" || message.includes("not confirmed")) {
    return "Confirm your email first. Check your inbox for the link we sent.";
  }
  if (error.code === "user_already_exists" || message.includes("already registered")) {
    return "There's already an account with that email. Try signing in.";
  }
  if (error.code === "weak_password" || message.includes("password should")) {
    return "Choose a stronger password.";
  }
  if (error.code === "over_email_send_rate_limit" || error.status === 429) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (message.includes("failed to fetch") || message.includes("network")) {
    return "Couldn't reach the server. Check your connection.";
  }
  return error.message;
}

async function run(task: () => Promise<{ error: { message: string } | null }>): Promise<AuthResult> {
  try {
    const { error } = await task();
    return error ? { ok: false, message: friendly(error) } : { ok: true };
  } catch (error) {
    return { ok: false, message: friendly({ message: error instanceof Error ? error.message : "Something went wrong" }) };
  }
}

/** Where email links (confirmation, password reset) send the player back to. */
const returnUrl = () => `${window.location.origin}/account`;

export function signIn(email: string, password: string) {
  return run(() => requireClient().auth.signInWithPassword({ email, password }));
}

export async function signUp(
  email: string,
  password: string,
): Promise<AuthResult & { needsConfirmation?: boolean }> {
  let needsConfirmation = false;
  const result = await run(async () => {
    const { data, error } = await requireClient().auth.signUp({
      email,
      password,
      options: { emailRedirectTo: returnUrl() },
    });
    // With email confirmation switched on, Supabase returns no session yet.
    needsConfirmation = !error && !data.session;
    return { error };
  });
  return result.ok ? { ok: true, needsConfirmation } : result;
}

export function sendPasswordReset(email: string) {
  return run(() => requireClient().auth.resetPasswordForEmail(email, { redirectTo: returnUrl() }));
}

export function updatePassword(password: string) {
  return run(() => requireClient().auth.updateUser({ password }));
}

export function signOut() {
  return run(() => requireClient().auth.signOut());
}

/** Deletes the login and, through the database's cascade, every saved match. */
export async function deleteAccount(): Promise<AuthResult> {
  const deleted = await run(async () => requireClient().rpc("delete_account"));
  if (!deleted.ok) return deleted;
  // The login no longer exists, so only this browser's session needs clearing.
  await requireClient().auth.signOut({ scope: "local" });
  return { ok: true };
}
