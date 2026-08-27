import type { Plugin, ViteDevServer } from "vite";

// Match the production Vercel rewrite in both local development and preview.
// The notice remains a static document; never mount the authenticated SPA here.
export function privacyRouting(): Plugin {
  const configure = (server: Pick<ViteDevServer, "middlewares">) => {
    server.middlewares.use((req, _res, next) => {
      const pathname = req.url?.split("?")[0];
      if (pathname === "/privacy" || pathname === "/privacy/") {
        req.url = "/privacy/index.html" + req.url!.slice(pathname.length);
      }
      next();
    });
  };
  return {
    name: "public-privacy-route",
    configureServer: configure,
    configurePreviewServer: configure,
  };
}
