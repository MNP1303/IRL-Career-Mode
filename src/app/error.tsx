"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/primitives";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <EmptyState
      icon={<TriangleAlert />}
      title="Something went wrong"
      action={
        <Button variant="cta" size="lg" onClick={reset}>
          Try again
        </Button>
      }
    >
      Your saved career is safe in this browser. Try again, or reload the page.
    </EmptyState>
  );
}
