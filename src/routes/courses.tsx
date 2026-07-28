import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy bookmark: course analysis now lives inside the Accounting report. */
export const Route = createFileRoute("/courses")({
  beforeLoad: () => {
    throw redirect({ to: "/accounting", replace: true });
  },
});
