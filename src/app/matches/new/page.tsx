import type { Metadata } from "next";
import { MatchForm } from "@/components/match/match-form";
import { PageHeader, Reveal } from "@/components/shared/primitives";
import { PageTransition } from "@/components/motion/page-transition";

export const metadata: Metadata = { title: "Log match" };

export default function Page() {
  return (
    <PageTransition>
      <Reveal>
        <PageHeader
          eyebrow="Match log"
          title="Log a match"
          description="Record what happened. Your XP and attributes update the moment you save."
        />
        <MatchForm />
      </Reveal>
    </PageTransition>
  );
}
