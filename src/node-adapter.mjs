export async function toWebRequest(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => headers.append(key, entry));
    } else if (typeof value === "string") {
      headers.set(key, value);
    }
  }

  const chunks = [];
  if (req.method !== "GET" && req.method !== "HEAD") {
    for await (const chunk of req) {
      chunks.push(chunk);
    }
  }

  const origin = `http://${req.headers.host || "localhost"}`;
  const init = {
    method: req.method || "GET",
    headers
  };

  if (chunks.length > 0) {
    init.body = Buffer.concat(chunks);
    init.duplex = "half";
  }

  return new Request(new URL(req.url || "/", origin), init);
}

export async function sendNodeResponse(res, response) {
  const headers = Object.fromEntries(response.headers.entries());
  res.writeHead(response.status, headers);
  const body = await response.arrayBuffer();
  res.end(Buffer.from(body));
}
