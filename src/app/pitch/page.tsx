import type { Metadata } from "next";
import { PitchScreen } from "@/components/screens/pitch-screen";
import { PageTransition } from "@/components/motion/page-transition";

export const metadata: Metadata = { title: "Pitch" };

export default function Page() {
  return (
    <PageTransition>
      <PitchScreen />
    </PageTransition>
  );
}
