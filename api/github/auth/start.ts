import type { VercelRequest, VercelResponse } from "@vercel/node";

function b64url(bytes: Uint8Array) { return Buffer.from(bytes).toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_"); }
async function challenge(verifier:string) {
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(hash));
}
export default async function handler(req:VercelRequest,res:VercelResponse) {
  if(req.method!=="GET") return res.status(405).json({error:"Method not allowed"});
  const clientId=process.env.GITHUB_CLIENT_ID, appUrl=process.env.APP_URL;
  if(!clientId||!appUrl) return res.status(500).json({error:"GITHUB_CLIENT_ID و APP_URL غير مضبوطين على الخادم."});
  const state=crypto.randomUUID();
  const verifier=b64url(crypto.getRandomValues(new Uint8Array(32)));
  const codeChallenge=await challenge(verifier);
  const callback=new URL("/api/github/auth/callback",appUrl);
  const authorize=new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id",clientId);
  authorize.searchParams.set("redirect_uri",callback.toString());
  authorize.searchParams.set("scope","repo");
  authorize.searchParams.set("state",state);
  authorize.searchParams.set("code_challenge",codeChallenge);
  authorize.searchParams.set("code_challenge_method","S256");
  const authState=encodeURIComponent(JSON.stringify({state,verifier}));
  res.setHeader("Set-Cookie",`github_oauth_state=${authState}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
  return res.redirect(302,authorize.toString());
}
