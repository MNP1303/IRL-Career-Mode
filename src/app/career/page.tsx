import type { Metadata } from "next";
import { CareerScreen } from "@/components/screens/career-screen";
import { PageTransition } from "@/components/motion/page-transition";

export const metadata: Metadata = { title: "Career" };

export default function Page() {
  return (
    <PageTransition>
      <CareerScreen />
    </PageTransition>
  );
}
