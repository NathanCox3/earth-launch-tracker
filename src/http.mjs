import path from "node:path";
import { promises as fs } from "node:fs";

export const STATIC_FILES = {
  "/": { fileName: "index.html", contentType: "text/html; charset=utf-8" },
  "/index.html": { fileName: "index.html", contentType: "text/html; charset=utf-8" },
  "/app.js": { fileName: "app.js", contentType: "application/javascript; charset=utf-8" },
  "/view-model.js": { fileName: "view-model.js", contentType: "application/javascript; charset=utf-8" },
  "/styles.css": { fileName: "styles.css", contentType: "text/css; charset=utf-8" }
};

export async function serveStaticFile(publicDir, asset) {
  const filePath = path.join(publicDir, asset.fileName);
  const data = await fs.readFile(filePath);
  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": "no-store"
    }
  });
}

export async function readJsonBody(request) {
  const text = (await request.text()).trim();
  return text ? JSON.parse(text) : {};
}

export function jsonResponse(statusCode, payload) {
  return new Response(`${JSON.stringify(payload, null, 2)}\n`, {
    status: statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export function resolvePathname(url) {
  const rewrittenPath = url.searchParams.get("__pathname");
  return rewrittenPath && rewrittenPath.startsWith("/") ? rewrittenPath : url.pathname;
}

export function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
