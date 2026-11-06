import type { Metadata } from "next";
import { MatchesScreen } from "@/components/screens/matches-screen";
import { PageTransition } from "@/components/motion/page-transition";

export const metadata: Metadata = { title: "Matches" };

export default function Page() {
  return (
    <PageTransition>
      <MatchesScreen />
    </PageTransition>
  );
}
