import { createFileRoute } from "@tanstack/react-router";
import { Labeler } from "@/components/labeler";

export const Route = createFileRoute("/")({
  component: Labeler,
});
