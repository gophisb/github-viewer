import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readSession } from "./session";

const SAFE_METHODS=new Set(["GET","HEAD"]);
const ALLOWED=[
  /^\\/user$/,
  /^\\/user\\/events(?:\\?.*)?$/,
  /^\\/user\\/repos(?:\\?.*)?$/,
  /^\\/repos\\/[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+(?:\\/.*)?$/
];

function cookies(req: VercelRequest) {
  return Object.fromEntries((req.headers.cookie||"").split(";").map(x=>x.trim()).filter(Boolean).map(x=>{
    const i=x.indexOf("="); return [x.slice(0,i),decodeURIComponent(x.slice(i+1))];
  }));
}
function originOk(req: VercelRequest) {
  const appUrl=process.env.APP_URL;
  const origin=req.headers.origin;
  if(!appUrl||!origin) return false;
  try { return new URL(origin).origin===new URL(appUrl).origin; } catch { return false; }
}
function pathAllowed(path:string) {
  return path.length<=600 && !path.includes("..") && ALLOWED.some(r=>r.test(path));
}
export default async function handler(req:VercelRequest,res:VercelResponse) {
  const method=(req.method||"GET").toUpperCase();
  if(method==="OPTIONS") return res.status(204).end();
  if(!["GET","POST","PUT","PATCH"].includes(method)) return res.status(405).json({error:"Method not allowed"});
  const session=await readSession(req);
  const rawPath=String(req.query.path||"");
  const path=rawPath.startsWith("/")?rawPath:"/"+rawPath;
  const publicAllowed=/^\\/users\\/[A-Za-z0-9-]+(?:\\/(repos|events|events\\/public))?(?:\\?.*)?$/.test(path);
  if(!session?.token && !(SAFE_METHODS.has(method) && publicAllowed)) return res.status(401).json({error:"GitHub session required"});
  if(!session?.token && !publicAllowed) return res.status(403).json({error:"GitHub operation is not allowlisted."});
  if(!SAFE_METHODS.has(method)) {
    const c=cookies(req);
    if(!originOk(req) || !c.github_csrf || c.github_csrf !== req.headers["x-csrf-token"]) return res.status(403).json({error:"CSRF validation failed."});
  }
  const url="https://api.github.com"+path;
  const headers:any={"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};
  if(session?.token) headers["Authorization"]=`Bearer ${session.token}`;
  let body:any=undefined;
  if(!SAFE_METHODS.has(method)) {
    headers["Content-Type"]="application/json";
    body=typeof req.body==="string"?req.body:JSON.stringify(req.body||{});
  }
  const upstream=await fetch(url,{method,headers,body});
  const text=await upstream.text();
  res.status(upstream.status);
  res.setHeader("Content-Type",upstream.headers.get("content-type")||"application/json");
  return res.send(text);
}
