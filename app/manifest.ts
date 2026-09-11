import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MotionLab 2.0",
    short_name: "MotionLab",
    description: "Movement analysis, training load and recovery in one private training app.",
    start_url: "/",
    display: "standalone",
    background_color: "#ECEFEC",
    theme_color: "#10271F",
    orientation: "portrait",
    categories: ["fitness", "sports", "health"],
    icons: [
      { src: "/icon.png", sizes: "any", type: "image/png", purpose: "any" },
      { src: "/icon.png", sizes: "any", type: "image/png", purpose: "maskable" },
    ],
  };
}
