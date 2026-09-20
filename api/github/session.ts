import type { VercelRequest, VercelResponse } from "@vercel/node";

const SESSION_COOKIE = "github_session";
const CSRF_COOKIE = "github_csrf";

function b64url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function fromB64url(s: string) {
  return Uint8Array.from(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4), "base64"));
}
function parseCookies(req: VercelRequest) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map(x => x.trim()).filter(Boolean).map(x => {
    const i=x.indexOf("="); return [x.slice(0,i), decodeURIComponent(x.slice(i+1))];
  }));
}
async function key() {
  const raw=process.env.SESSION_ENCRYPTION_KEY || "";
  const bytes=/^[0-9a-fA-F]{64}$/.test(raw) ? Uint8Array.from(raw.match(/../g)!.map(x=>parseInt(x,16))) : fromB64url(raw);
  if(bytes.length!==32) throw new Error("SESSION_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return crypto.subtle.importKey("raw",bytes,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}
export async function seal(value: any) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const k=await key();
  const data=new TextEncoder().encode(JSON.stringify(value));
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},k,data));
  return b64url(iv)+"."+b64url(encrypted);
}
export async function unseal(value: string) {
  const [ivPart,dataPart]=value.split(".");
  if(!ivPart||!dataPart) throw new Error("Invalid session.");
  const k=await key();
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromB64url(ivPart)},k,fromB64url(dataPart));
  return JSON.parse(new TextDecoder().decode(plain));
}
export function clearCookies(res: VercelResponse) {
  res.setHeader("Set-Cookie", [
    `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
    `${CSRF_COOKIE}=; Secure; SameSite=Lax; Path=/; Max-Age=0`,
    `github_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
  ]);
}
export async function readSession(req: VercelRequest) {
  const c=parseCookies(req), raw=c[SESSION_COOKIE];
  if(!raw) return null;
  try {
    const s=await unseal(raw);
    if(!s?.token || !s?.exp || Date.now() > Number(s.exp)) return null;
    return s;
  } catch { return null; }
}
export default async function handler(req: VercelRequest,res: VercelResponse) {
  if(req.method!=="GET") return res.status(405).json({error:"Method not allowed"});
  const s=await readSession(req);
  if(!s) return res.status(200).json({authenticated:false});
  return res.status(200).json({authenticated:true,user:s.user||null,expires_at:s.exp});
}
