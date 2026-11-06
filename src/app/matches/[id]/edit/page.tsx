import type { Metadata } from "next";
import { Suspense } from "react";
import { MatchEditScreen } from "@/components/screens/match-detail-screen";
import { PageTransition } from "@/components/motion/page-transition";

export const metadata: Metadata = { title: "Edit match" };

export default function Page() {
  return (
    <PageTransition>
      <Suspense fallback={<div className="skeleton h-80" />}>
        <MatchEditScreen />
      </Suspense>
    </PageTransition>
  );
}
