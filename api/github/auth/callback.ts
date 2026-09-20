import { seal } from "../session";

function cookies(req:any) {
  return Object.fromEntries((req.headers.cookie||"").split(";").map(x=>x.trim()).filter(Boolean).map(x=>{
    const i=x.indexOf("="); return [x.slice(0,i),decodeURIComponent(x.slice(i+1))];
  }));
}
function b64url(bytes:Uint8Array){return Buffer.from(bytes).toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");}

export default async function handler(req:any,res:any) {
  if(req.method!=="GET") return res.status(405).json({error:"Method not allowed"});
  const {code,state}=req.query, c=cookies(req);
  let oauth:any=null;
  try { oauth=c.github_oauth_state?JSON.parse(c.github_oauth_state):null; } catch {}
  if(!code||typeof code!=="string"||!state||state!==oauth?.state) return res.status(400).send("OAuth state غير صالح.");
  const clientId=process.env.GITHUB_CLIENT_ID, clientSecret=process.env.GITHUB_CLIENT_SECRET, appUrl=process.env.APP_URL;
  if(!clientId||!clientSecret||!appUrl||!oauth?.verifier) return res.status(500).send("إعدادات GitHub OAuth ناقصة على الخادم.");
  const callback=new URL("/api/github/auth/callback",appUrl).toString();
  const tokenRes=await fetch("https://github.com/login/oauth/access_token",{method:"POST",headers:{"Accept":"application/json","Content-Type":"application/json"},body:JSON.stringify({client_id:clientId,client_secret:clientSecret,code,redirect_uri:callback,code_verifier:oauth.verifier})});
  const token=await tokenRes.json() as any;
  if(!tokenRes.ok||!token.access_token) return res.status(502).send("فشل تبادل رمز GitHub.");
  const userRes=await fetch("https://api.github.com/user",{headers:{"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","Authorization":`Bearer ${token.access_token}`}});
  if(!userRes.ok) return res.status(502).send("تعذر التحقق من هوية GitHub.");
  const user=await userRes.json() as any;
  const exp=Date.now()+Math.min(Number(token.expires_in||28800)*1000,8*60*60*1000);
  const session=await seal({token:token.access_token,exp,user:{login:user.login,name:user.name,avatar_url:user.avatar_url,html_url:user.html_url}});
  const csrf=b64url(crypto.getRandomValues(new Uint8Array(32)));
  res.setHeader("Set-Cookie",[
    `github_session=${session}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor((exp-Date.now())/1000)}`,
    `github_csrf=${csrf}; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor((exp-Date.now())/1000)}`,
    `github_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
  ]);
  return res.redirect(302,new URL("/",appUrl).toString());
}
