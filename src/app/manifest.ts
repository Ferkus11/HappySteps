import type { MetadataRoute } from "next";

/** Web app manifest (served at /manifest.webmanifest). Colours follow the brand tokens in globals.css. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Happy Steps",
    short_name: "Happy Steps",
    description: "Детский сад в телефоне: посещаемость, меню, оплата, чаты и новости для родителей и сотрудников.",
    lang: "ru",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f7fb",
    theme_color: "#c02a62",
    categories: ["education", "productivity", "social"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
