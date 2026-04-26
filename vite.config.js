import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnv } from "vite";

const dynamicImport = new Function("specifier", "return import(specifier)");

function createMockResponse(serverResponse) {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      serverResponse.setHeader(name, value);
    },
    status(code) {
      this.statusCode = code;
      serverResponse.statusCode = code;
      return this;
    },
    json(payload) {
      if (!serverResponse.headersSent) {
        serverResponse.setHeader("Content-Type", "application/json");
      }
      serverResponse.end(JSON.stringify(payload));
    },
  };
}

function localApiMiddleware() {
  return {
    name: "planit-local-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/admin/user-task-report")) {
          next();
          return;
        }

        try {
          const requestUrl = new URL(req.url, "http://127.0.0.1");
          const handlerPath = path.resolve("api/admin/user-task-report.js");
          const handlerModule = await dynamicImport(
            `${pathToFileURL(handlerPath).href}?t=${Date.now()}`
          );
          req.query = Object.fromEntries(requestUrl.searchParams.entries());
          await handlerModule.default(req, createMockResponse(res));
        } catch (error) {
          console.error("local api middleware error:", error);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
          }
          res.end(
            JSON.stringify({
              code: "LOCAL_API_ERROR",
              message: "Failed to run the local admin API route.",
            })
          );
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));

  return {
    plugins: [react(), tailwindcss(), localApiMiddleware()],
    server: {
      host: true,
    },
  };
});
