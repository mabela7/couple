async function verifyUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_WEB_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: token })
  });
  if (!response.ok) return null;
  const data = await response.json();
  const user = data.users?.[0];
  const allowed = (env.ALLOWED_UIDS || "").split(",").map(x => x.trim()).filter(Boolean);
  return user && allowed.includes(user.localId) ? user : null;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    const user = await verifyUser(request, env);
    if (!user) return new Response("Unauthorized", { status: 401, headers: corsHeaders() });
    const match = url.pathname.match(/^\/(upload|file)\/(.+)$/);
    if (!match) return new Response("Not found", { status: 404, headers: corsHeaders() });
    const [, action, encodedKey] = match;
    const key = decodeURIComponent(encodedKey);
    if (!key || key.includes("..")) return new Response("Invalid key", { status: 400, headers: corsHeaders() });
    if (request.method === "PUT" && action === "upload") {
      const body = await request.arrayBuffer();
      if (body.byteLength > 104857600) return new Response("Maximum file size is 100 MB", { status: 413, headers: corsHeaders() });
      await env.PRIVATE_MEDIA.put(key, body, { httpMetadata: { contentType: request.headers.get("Content-Type") || "application/octet-stream" } });
      return Response.json({ ok: true, key }, { headers: corsHeaders() });
    }
    if (request.method === "GET" && action === "file") {
      const object = await env.PRIVATE_MEDIA.get(key);
      if (!object) return new Response("Not found", { status: 404, headers: corsHeaders() });
      const headers = new Headers(corsHeaders());
      object.writeHttpMetadata(headers);
      headers.set("Cache-Control", "private, no-store");
      headers.set("Content-Disposition", "inline");
      return new Response(object.body, { headers });
    }
    return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
  }
};
