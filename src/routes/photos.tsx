import { createFileRoute } from "@tanstack/react-router";
import { PhotosPage } from "@/components/photos-page";

export const Route = createFileRoute("/photos")({
  component: PhotosPage,
});
