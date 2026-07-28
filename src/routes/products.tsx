import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy bookmark: product analysis now lives inside the Accounting report. */
export const Route = createFileRoute("/products")({
  beforeLoad: () => {
    throw redirect({ to: "/accounting", replace: true });
  },
});
