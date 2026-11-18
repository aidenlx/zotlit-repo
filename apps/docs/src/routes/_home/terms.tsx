import { createFileRoute } from "@tanstack/react-router";

import {
  ServicePolicy,
  servicePolicyHead,
} from "@/components/service-policy.tsx";

export const Route = createFileRoute("/_home/terms")({
  component: () => <ServicePolicy kind="terms" />,
  head: () => servicePolicyHead("terms"),
});
