import type { MetadataRoute } from "next";

// Phase 0: internal/testing deployment, not the public launch — see the
// robots metadata note in layout.tsx. Remove/relax at public launch.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
