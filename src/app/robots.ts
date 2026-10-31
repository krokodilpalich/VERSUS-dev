import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/dashboard/",
        "/admin/",
        "/private/",
        "/sign-in",
        "/sign-up",
        "/onboarding",
        "/reset-password",
      ],
    },
    sitemap: `${process.env.APP_URL}/sitemap.xml`,
  };
}
