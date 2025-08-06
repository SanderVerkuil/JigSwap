import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JigSwap",
    short_name: "JigSwap",
    description: "JigSwap is a platform for trading puzzles",
    start_url: "/",
    display: "standalone",
    theme_color: "#494e92",
    background_color: "#494e92",
    icons: [
      {
        src: "/images/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/images/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
