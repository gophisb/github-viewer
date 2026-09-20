import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const clientId = process.env.GITHUB_CLIENT_ID;
  const appUrl = process.env.APP_URL;
  if (!clientId || !appUrl) return res.status(500).json({ error: "GITHUB_CLIENT_ID و APP_URL غير مضبوطين على الخادم." });
  const state = crypto.randomUUID();
  const callback = new URL("/api/github/auth/callback", appUrl);
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", callback.toString());
  authorize.searchParams.set("scope", "repo");
  authorize.searchParams.set("state", state);
  res.setHeader("Set-Cookie", "github_oauth_state="+encodeURIComponent(state)+"; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600");
  return res.redirect(302, authorize.toString());
}
