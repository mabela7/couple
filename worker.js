// Cloudflare Worker — private file storage for Us.
// Dashboard setup: Workers & Pages > Create > Hello World > Edit code > paste this file > Deploy.
// Then Settings > Bindings: R2 bucket  → name PRIVATE_MEDIA, bucket us-private-media
// Settings > Variables: FIREBASE_WEB_API_KEY = your Firebase web apiKey
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400"
};
const MAX = 100 * 1024 * 1024;

async function uidFromToken(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
  if (!token) return null;
  const r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + env.FIREBASE_WEB_API_KEY, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: token })
  });
  if (!r.ok) return null;
  return (await r.json()).users?.[0]?.localId || null;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const uid = await uidFromToken(request, env);
    if (!uid || uid.length < 20) return new Response("Unauthorized", { status: 401, headers: CORS });

    const m = new URL(request.url).pathname.match(/^\/(upload|file)\/(.+)$/);
    if (!m) return new Response("Not found", { status: 404, headers: CORS });
    let key;
    try { key = decodeURIComponent(m[2]); } catch { return new Response("Bad key", { status: 400, headers: CORS }); }
    // key = "<uidA>_<uidB>~<timestamp>-<name>" — only the two people in that room may touch it
    const roomPart = key.split("~")[0];
    if (!/^[A-Za-z0-9_]+$/.test(roomPart) || !roomPart.includes(uid) || key.includes(".."))
      return new Response("Forbidden", { status: 403, headers: CORS });

    if (m[1] === "upload" && request.method === "PUT") {
      const len = +request.headers.get("Content-Length") || 0;
      if (!len) return new Response("Length required", { status: 411, headers: CORS });
      if (len > MAX) return new Response("Max file size is 100 MB", { status: 413, headers: CORS });
      await env.PRIVATE_MEDIA.put(key, request.body, {
        httpMetadata: { contentType: request.headers.get("Content-Type") || "application/octet-stream" }
      });
      return Response.json({ ok: true, key }, { headers: CORS });
    }
    if (m[1] === "file" && request.method === "GET") {
      const obj = await env.PRIVATE_MEDIA.get(key);
      if (!obj) return new Response("Not found", { status: 404, headers: CORS });
      const h = new Headers(CORS);
      obj.writeHttpMetadata(h);
      h.set("Cache-Control", "private, no-store");
      h.set("X-Content-Type-Options", "nosniff");
      h.set("Content-Security-Policy", "sandbox");
      return new Response(obj.body, { headers: h });
    }
    return new Response("Method not allowed", { status: 405, headers: CORS });
  }
};
