import type { MetadataRoute } from "next";
import { SURFACE } from "@/lib/palette";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MotionLab 2.0",
    short_name: "MotionLab",
    description: "Movement analysis, training load and recovery in one private training app.",
    start_url: "/",
    display: "standalone",
    // Match the document's inline first-paint colour. Standalone mode shows
    // this before Next or the stylesheet has loaded.
    background_color: SURFACE.graphite,
    theme_color: SURFACE.graphite,
    orientation: "portrait",
    categories: ["fitness", "sports", "health"],
    icons: [
      { src: "/icon.png", sizes: "any", type: "image/png", purpose: "any" },
      { src: "/icon.png", sizes: "any", type: "image/png", purpose: "maskable" },
    ],
  };
}
