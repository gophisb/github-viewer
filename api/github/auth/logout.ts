import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clearCookies } from "../session";
export default function handler(req: VercelRequest,res: VercelResponse) {
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  clearCookies(res);
  return res.status(200).json({ok:true});
}
