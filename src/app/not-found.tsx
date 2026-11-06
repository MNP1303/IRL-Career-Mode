import { Compass } from "lucide-react";
import { EmptyState, LinkButton } from "@/components/shared/primitives";

export default function NotFound() {
  return (
    <EmptyState
      icon={<Compass />}
      title="Out of play"
      action={
        <LinkButton href="/" variant="cta" size="lg">
          Back to the hub
        </LinkButton>
      }
    >
      That page isn&apos;t part of this career.
    </EmptyState>
  );
}
