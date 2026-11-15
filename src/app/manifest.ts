import type { MetadataRoute } from "next";

/** Installable PWA (AGENTS.md §7). Served at /manifest.webmanifest. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "جمعيتي",
    short_name: "جمعيتي",
    description: "دفتر جمعيتك، مترتب ومضمون: الأعضاء، الأسامي، الأدوار، والتحصيل.",
    lang: "ar",
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F7F5F0",
    theme_color: "#0E6474",
    icons: [
      { src: "/icons/192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
