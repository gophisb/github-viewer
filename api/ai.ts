export default async function handler(req:any,res:any){
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  try{
    const key=process.env.OPENAI_API_KEY;
    if(!key) return res.status(500).json({error:"OPENAI_API_KEY غير مضبوط على الخادم."});
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const input=String(body.input||"").trim();
    const model=String(body.model||process.env.OPENAI_MODEL||"gpt-5.6-luna").trim();
    if(!input) return res.status(400).json({error:"input مطلوب."});
    if(input.length>300000) return res.status(413).json({error:"الطلب كبير جدًا."});
    const allowed=(process.env.OPENAI_ALLOWED_MODELS||"gpt-5.6-luna").split(",").map(x=>x.trim()).filter(Boolean);
    if(!allowed.includes(model)) return res.status(400).json({error:"النموذج غير مسموح به."});
    const r=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},
      body:JSON.stringify({model,input,max_output_tokens:14000})
    });
    const raw=await r.text();
    if(!r.ok) return res.status(r.status).json({error:"OpenAI request failed",details:raw.slice(0,4000)});
    const d=JSON.parse(raw);
    const output=typeof d.output_text==="string"?d.output_text:(d.output||[]).flatMap((x:any)=>x.content||[]).map((x:any)=>x.text||"").join("\n");
    return res.status(200).json({output_text:output});
  }catch(e){
    return res.status(500).json({error:e instanceof Error?e.message:"Server error"});
  }
}