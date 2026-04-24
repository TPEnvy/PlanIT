import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import scheduledWriteHandler from "./api/tasks/scheduled-write.js";
import { invokeJsonHandler } from "./api/_lib/invokeHandler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, "dist");
const API_ROUTE = "/api/tasks/scheduled-write";

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function normalizeHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key.toLowerCase(),
      Array.isArray(value) ? value.join(", ") : String(value || ""),
    ])
  );
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function setHeaders(res, headers = {}) {
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
}

async function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const content = await fs.readFile(filePath);
  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream",
    "Cache-Control":
      filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
  });
  res.end(content);
}

async function serveSpaRequest(req, res, pathname) {
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolvedPath = path.resolve(DIST_DIR, relativePath);

  if (!resolvedPath.startsWith(path.resolve(DIST_DIR))) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(resolvedPath);
    if (stat.isFile()) {
      await serveFile(res, resolvedPath);
      return;
    }
  } catch {
    // Fall back to the SPA shell below.
  }

  try {
    await serveFile(res, path.join(DIST_DIR, "index.html"));
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Build output not found. Run the frontend build before starting Railway.");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && requestUrl.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (requestUrl.pathname === API_ROUTE) {
      const body = ["POST", "PUT", "PATCH"].includes(req.method || "")
        ? await readJsonBody(req)
        : {};
      const adapted = await invokeJsonHandler(scheduledWriteHandler, {
        method: req.method,
        headers: normalizeHeaders(req.headers),
        body,
      });

      setHeaders(res, adapted.headers);
      res.writeHead(adapted.statusCode);
      res.end(adapted.body);
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      await serveSpaRequest(req, res, requestUrl.pathname);
      return;
    }

    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        code: "METHOD_NOT_ALLOWED",
        message: "Method not allowed.",
      })
    );
  } catch (error) {
    console.error("railway-server error:", error);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        code: "INTERNAL_ERROR",
        message: "The Railway server failed to handle the request.",
      })
    );
  }
});

const port = Number(process.env.PORT || 3000);

server.listen(port, () => {
  console.log(`Railway server listening on port ${port}`);
});
