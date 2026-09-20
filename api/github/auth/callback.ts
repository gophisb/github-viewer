import type { VercelRequest, VercelResponse } from "@vercel/node";

function cookies(req: VercelRequest) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map(x => x.trim()).filter(Boolean).map(x => {
    const i=x.indexOf("="); return [x.slice(0,i), decodeURIComponent(x.slice(i+1))];
  }));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const { code, state } = req.query;
  const c = cookies(req);
  if (!code || typeof code !== "string" || !state || state !== c.github_oauth_state) return res.status(400).send("OAuth state غير صالح.");
  const clientId=process.env.GITHUB_CLIENT_ID, clientSecret=process.env.GITHUB_CLIENT_SECRET, appUrl=process.env.APP_URL;
  if(!clientId||!clientSecret||!appUrl) return res.status(500).send("إعدادات GitHub OAuth ناقصة على الخادم.");
  const tokenRes=await fetch("https://github.com/login/oauth/access_token",{method:"POST",headers:{"Accept":"application/json","Content-Type":"application/json"},body:JSON.stringify({client_id:clientId,client_secret:clientSecret,code})});
  const token=await tokenRes.json() as any;
  if(!tokenRes.ok||!token.access_token) return res.status(502).send("فشل تبادل رمز GitHub.");
  if(!process.env.SESSION_ENCRYPTION_KEY) return res.status(500).send("SESSION_ENCRYPTION_KEY غير مضبوط؛ لن يتم وضع رمز GitHub في المتصفح.");
  return res.status(500).send("جلسة OAuth غير مفعلة بعد: يلزم تفعيل مخزن جلسات مشفر قبل الإنتاج.");
}
