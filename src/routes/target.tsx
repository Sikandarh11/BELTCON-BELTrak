import { createFileRoute } from "@tanstack/react-router";

import { OperationalDataUnavailable } from "@/components/OperationalDataUnavailable";

export const Route = createFileRoute("/target")({
  head: () => ({ meta: [{ title: "Target Information · BELTCON SBTS" }] }),
  validateSearch: (search: Record<string, unknown>) => ({ bagId: (search.bagId as string) || "" }),
  component: Target,
});

function Target() {
  return (
    <OperationalDataUnavailable
      title="Target Information"
      subtitle="Bag profile and movement timeline"
      feature="Bag detail and movement history"
      action={{ to: "/recheck", label: "Open authoritative Recheck case" }}
    />
  );
}
