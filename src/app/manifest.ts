import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Full Speed — Acquisition",
    short_name: "Full Speed",
    description: "نظام فريق الأكوزيشن — Full Speed Logistics",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0b1020",
    theme_color: "#ea580c",
    lang: "ar",
    dir: "rtl",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "ابدأ المكالمات", short_name: "مكالمات", url: "/agent/next", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "ليد جديد", short_name: "ليد جديد", url: "/agent/leads/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "المتابعة اللايف", short_name: "لايف", url: "/admin/live", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
