import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy bookmark kept during the Accounting migration. */
export const Route = createFileRoute("/sales")({
  beforeLoad: () => {
    throw redirect({ to: "/accounting", replace: true });
  },
});
