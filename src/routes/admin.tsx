import { createFileRoute } from "@tanstack/react-router";
import { ClassesAdmin } from "@/components/classes-admin";

export const Route = createFileRoute("/admin")({
  component: ClassesAdmin,
});
