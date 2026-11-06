"use client";

import { useState, type FormEvent } from "react";
import { Eye, EyeOff, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/match/form-controls";
import { Segmented } from "@/components/shared/primitives";
import { sendPasswordReset, signIn, signUp, updatePassword } from "@/lib/auth";
import { actions } from "@/lib/store";

type Mode = "sign-in" | "sign-up" | "reset";

const MIN_PASSWORD = 8;
const emailSchema = z.string().trim().email("Enter a valid email address");
const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters`)
  .max(72, "Use 72 characters or fewer");

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  invalid: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={invalid}
        className="pr-11"
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        aria-label={visible ? "Hide password" : "Show password"}
        onClick={() => setVisible(!visible)}
        className="absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function Notice({ title, children, onBack }: { title: string; children: React.ReactNode; onBack: () => void }) {
  return (
    <div className="text-center" role="status">
      <div className="mx-auto mb-4 grid size-11 place-items-center rounded-full bg-accent text-foreground">
        <MailCheck className="size-5" />
      </div>
      <h2 className="heading text-xl">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{children}</p>
      <Button variant="outline" className="mt-5" onClick={onBack}>
        Back to sign in
      </Button>
    </div>
  );
}

export function AuthForm() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setErrors({});
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const checkedEmail = emailSchema.safeParse(email);
    const passwordIssue =
      mode === "reset"
        ? undefined
        : mode === "sign-up"
          ? newPasswordSchema.safeParse(password).error?.issues[0]?.message
          : password
            ? undefined
            : "Enter your password";
    const next = { email: checkedEmail.error?.issues[0]?.message, password: passwordIssue };
    setErrors(next);
    if (next.email || next.password || !checkedEmail.success) return;

    setBusy(true);
    const address = checkedEmail.data;
    if (mode === "sign-in") {
      const result = await signIn(address, password);
      if (result.ok) toast.success("Signed in");
      else setErrors({ form: result.message });
    } else if (mode === "sign-up") {
      const result = await signUp(address, password);
      if (!result.ok) setErrors({ form: result.message });
      else if (result.needsConfirmation) {
        setNotice({
          title: "Check your inbox",
          body: `We sent a confirmation link to ${address}. Open it on this device to finish creating your account.`,
        });
      } else toast.success("Account created");
    } else {
      const result = await sendPasswordReset(address);
      if (result.ok) {
        setNotice({
          title: "Reset link sent",
          body: `If there's an account for ${address}, a link to choose a new password is on its way.`,
        });
      } else setErrors({ form: result.message });
    }
    setBusy(false);
  }

  if (notice) {
    return (
      <Notice
        title={notice.title}
        onBack={() => {
          setNotice(null);
          switchMode("sign-in");
        }}
      >
        {notice.body}
      </Notice>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {mode === "reset" ? (
        <div>
          <h2 className="heading text-xl">Reset password</h2>
          <p className="mt-1 text-sm text-muted-foreground">We&apos;ll email you a link to choose a new one.</p>
        </div>
      ) : (
        <Segmented
          label="Account action"
          value={mode}
          onChange={switchMode}
          options={[
            { value: "sign-in", label: "Sign in" },
            { value: "sign-up", label: "Create account" },
          ]}
          className="flex"
        />
      )}

      <Field label="Email" htmlFor="email" error={errors.email}>
        <Input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          aria-invalid={Boolean(errors.email)}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>

      {mode !== "reset" ? (
        <Field
          label="Password"
          htmlFor="password"
          error={errors.password}
          hint={mode === "sign-up" ? `At least ${MIN_PASSWORD} characters` : undefined}
        >
          <PasswordInput
            id="password"
            value={password}
            onChange={setPassword}
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            invalid={Boolean(errors.password)}
          />
        </Field>
      ) : null}

      {errors.form ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors.form}
        </p>
      ) : null}

      <Button type="submit" variant="cta" size="lg" className="w-full" disabled={busy}>
        {busy ? "Working…" : mode === "sign-in" ? "Sign in" : mode === "sign-up" ? "Create account" : "Send reset link"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {mode === "sign-in" ? (
          <button type="button" className="underline-offset-4 hover:text-foreground hover:underline" onClick={() => switchMode("reset")}>
            Forgot your password?
          </button>
        ) : mode === "reset" ? (
          <button type="button" className="underline-offset-4 hover:text-foreground hover:underline" onClick={() => switchMode("sign-in")}>
            Back to sign in
          </button>
        ) : (
          "Your guest career can come with you once you're signed in."
        )}
      </p>
    </form>
  );
}

/** Shown after a password reset link signs the player in. */
export function NewPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const issue = newPasswordSchema.safeParse(password).error?.issues[0]?.message;
    if (issue) return setError(issue);
    if (password !== confirm) return setError("The passwords don't match");
    setBusy(true);
    const result = await updatePassword(password);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    actions.finishRecovery();
    toast.success("Password updated");
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <div>
        <h2 className="heading text-xl">Choose a new password</h2>
        <p className="mt-1 text-sm text-muted-foreground">You&apos;re signed in from your reset link.</p>
      </div>
      <Field label="New password" htmlFor="new-password" hint={`At least ${MIN_PASSWORD} characters`}>
        <PasswordInput id="new-password" value={password} onChange={setPassword} autoComplete="new-password" invalid={Boolean(error)} />
      </Field>
      <Field label="Confirm password" htmlFor="confirm-password" error={error}>
        <PasswordInput id="confirm-password" value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={Boolean(error)} />
      </Field>
      <Button type="submit" variant="cta" size="lg" className="w-full" disabled={busy}>
        {busy ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
