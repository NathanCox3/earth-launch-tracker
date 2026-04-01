import { createServer } from "node:http";
import { createEarthLaunchTrackerRuntime } from "./bootstrap.mjs";
import { sendNodeResponse, toWebRequest } from "./node-adapter.mjs";

async function main() {
  const runtime = createEarthLaunchTrackerRuntime();

  const server = createServer(async (req, res) => {
    try {
      const response = await runtime.app(await toWebRequest(req));
      await sendNodeResponse(res, response);
    } catch (error) {
      const statusCode = Number(error?.statusCode) || 500;
      res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(`${JSON.stringify({ error: error?.message || "Unexpected server error." }, null, 2)}\n`);
    }
  });

  server.listen(runtime.config.runtime.port, () => {
    console.log(`Earth Launch Tracker running at http://localhost:${runtime.config.runtime.port}`);
  });
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
