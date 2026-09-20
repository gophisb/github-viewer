import { useEffect, useMemo, useState } from "react";

type RepoLite = { id:number; full_name:string; default_branch:string };
declare global { interface Window { JSZip:any } }

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const AI_KEY = "github-viewer-openai-key";
const AI_MODEL_KEY = "github-viewer-openai-model";

async function gh<T>(path:string, token:string, init:RequestInit={}) : Promise<T> {
  const r = await fetch(path.startsWith("http") ? path : API + path, {
    ...init,
    headers: {
      Accept:"application/vnd.github+json",
      "X-GitHub-Api-Version":API_VERSION,
      ...(token ? {Authorization:`Bearer ${token}`} : {}),
      ...(init.body ? {"Content-Type":"application/json"} : {})
    }
  });
  if (!r.ok) throw new Error((await r.text()) || `GitHub API ${r.status}`);
  return r.json();
}

async function ai(apiKey:string, model:string, input:string) {
  const r = await fetch("https://api.openai.com/v1/responses", {
    method:"POST",
    headers:{"Content-Type":"application/json",Authorization:`Bearer ${apiKey}`},
    body:JSON.stringify({model,input,max_output_tokens:12000})
  });
  if (!r.ok) throw new Error((await r.text()) || `OpenAI API ${r.status}`);
  const d = await r.json();
  return typeof d.output_text === "string" ? d.output_text :
    (d.output || []).flatMap((x:any)=>x.content || []).map((x:any)=>x.text || "").join("\n");
}

function jsonFrom(text:string) {
  const clean=text.replace(/^\s*```json\s*/i,"").replace(/\s*```\s*$/,"").trim();
  const a=clean.indexOf("{"), b=clean.lastIndexOf("}");
  if(a<0||b<a) throw new Error("لم يُرجع الذكاء الاصطناعي JSON صالحًا.");
  return JSON.parse(clean.slice(a,b+1));
}

function safePath(p:string) {
  const x=p.replace(/\\/g,"/").replace(/^\/+/,"");
  if(!x || x.split("/").some((part:string)=>part===".." || part==="")) throw new Error(`مسار غير آمن: ${p}`);
  return x;
}

function b64(s:string) {
  return btoa(unescape(encodeURIComponent(s)));
}

export default function AIEngineeringAgent({repos,token,onDone}:{repos:RepoLite[];token:string;onDone:()=>void}) {
  const [apiKey,setApiKey]=useState(()=>localStorage.getItem(AI_KEY)||"");
  const [model,setModel]=useState(()=>localStorage.getItem(AI_MODEL_KEY)||"gpt-5.6-luna");
  const [repoName,setRepoName]=useState(repos[0]?.full_name||"");
  const [zip,setZip]=useState<File|null>(null);
  const [command,setCommand]=useState("");
  const [plan,setPlan]=useState<any|null>(null);
  const [approved,setApproved]=useState(false);
  const [running,setRunning]=useState(false);
  const [log,setLog]=useState<string[]>([]);
  const [result,setResult]=useState("");

  useEffect(()=>{ if(!repoName && repos[0]) setRepoName(repos[0].full_name); },[repos,repoName]);

  const manifest=useMemo(()=> {
    if(!zip) return "";
    return `ZIP: ${zip.name} | ${Math.round(zip.size/1024)} KB`;
  },[zip]);

  const analyze=async()=>{
    if(!apiKey.trim()||!command.trim()||!repoName||running) return;
    setRunning(true); setResult(""); setPlan(null); setApproved(false); setLog(["ASSESS: قراءة الطلب..."]);
    localStorage.setItem(AI_KEY,apiKey.trim()); localStorage.setItem(AI_MODEL_KEY,model.trim());
    try {
      const repo=repos.find(r=>r.full_name===repoName)!;
      let zipInfo=manifest;
      if(zip){
        if(!window.JSZip) throw new Error("محرك ZIP غير جاهز؛ أعد تحميل الصفحة.");
        const z=await window.JSZip.loadAsync(zip);
        const names=Object.values(z.files).filter((x:any)=>!x.dir).map((x:any)=>String(x.name).replace(/\\/g,"/")).slice(0,500);
        zipInfo += "\nFILES:\n"+names.join("\n");
      }
      const prompt=`أنت وكيل هندسة برمجيات مضبوط داخل GitHub Viewer.
المستودع: ${repo.full_name}
الفرع الأساسي: ${repo.default_branch}
طلب المستخدم: ${command}
ملف ZIP المرفق: ${zipInfo||"لا يوجد"}

حلل الطلب فقط، ولا تنفذ شيئًا. أعد JSON فقط بالشكل:
{"summary":"...","risk":"low|medium|high","actions":[{"type":"upload_zip|inspect_repo|modify_repo","reason":"...","target_folder":"","paths":[]}]}
قواعد:
- إذا كان الطلب يتطلب رفع ZIP فاختر upload_zip.
- لا تقترح حذف ملفات.
- أي تعديل على المستودع يجب أن يتم على فرع مستقل ثم Pull Request، وليس على الفرع الأساسي.
- إذا لم يوجد ZIP فلا تختر upload_zip.`;
      setLog(x=>[...x,"PLAN: استشارة نموذج الذكاء الاصطناعي..."]);
      const p=jsonFrom(await ai(apiKey.trim(),model.trim(),prompt));
      setPlan(p);
      setLog(x=>[...x,"PLAN: تم إنشاء الخطة. بانتظار موافقتك."]);
    } catch(e){ setResult(e instanceof Error?e.message:"فشل التحليل."); }
    finally{ setRunning(false); }
  };

  const execute=async()=>{
    if(!plan||!approved||running) return;
    const repo=repos.find(r=>r.full_name===repoName)!;
    setRunning(true); setResult("");
    try {
      const ref=await gh<any>(`/repos/${repo.full_name}/git/ref/heads/${encodeURIComponent(repo.default_branch)}`,token);
      const baseSha=ref.object.sha;
      const branch=`ai-agent/${Date.now()}`;
      setLog(x=>[...x,`ISOLATE: إنشاء الفرع ${branch}`]);
      await gh(`/repos/${repo.full_name}/git/refs`,token,{method:"POST",body:JSON.stringify({ref:`refs/heads/${branch}`,sha:baseSha})});

      if(plan.actions?.some((a:any)=>a.type==="upload_zip")){
        if(!zip) throw new Error("الخطة تطلب ZIP لكن لم يتم اختيار ملف ZIP.");
        if(!window.JSZip) throw new Error("محرك ZIP غير جاهز.");
        const z=await window.JSZip.loadAsync(zip);
        const entries=Object.values(z.files).filter((x:any)=>!x.dir) as any[];
        if(!entries.length) throw new Error("ZIP فارغ.");
        const repoFolder=String(plan.actions.find((a:any)=>a.type==="upload_zip")?.target_folder||"").replace(/^\/+|\/+$/g,"");
        const tree:any[]=[];
        for(let i=0;i<entries.length;i++){
          const e=entries[i];
          const raw=safePath(String(e.name));
          const path=[repoFolder,raw].filter(Boolean).join("/");
          setLog(x=>[...x,`UPLOAD: ${i+1}/${entries.length} ${path}`]);
          const content=await e.async("base64");
          const blob=await gh<any>(`/repos/${repo.full_name}/git/blobs`,token,{method:"POST",body:JSON.stringify({content,encoding:"base64"})});
          tree.push({path,mode:"100644",type:"blob",sha:blob.sha});
        }
        const parent=await gh<any>(`/repos/${repo.full_name}/git/commits/${baseSha}`,token);
        const t=await gh<any>(`/repos/${repo.full_name}/git/trees`,token,{method:"POST",body:JSON.stringify({base_tree:parent.tree.sha,tree})});
        const c=await gh<any>(`/repos/${repo.full_name}/git/commits`,token,{method:"POST",body:JSON.stringify({message:`AI Agent: ${command.slice(0,72)}`,tree:t.sha,parents:[baseSha]})});
        await gh(`/repos/${repo.full_name}/git/refs/heads/${encodeURIComponent(branch)}`,token,{method:"PATCH",body:JSON.stringify({sha:c.sha,force:false})});
        setLog(x=>[...x,"VERIFY: إعادة قراءة الفرع بعد الرفع..."]);
        await gh(`/repos/${repo.full_name}/git/ref/heads/${encodeURIComponent(branch)}`,token);
        const pr=await gh<any>(`/repos/${repo.full_name}/pulls`,token,{method:"POST",body:JSON.stringify({title:`AI Agent: ${command.slice(0,72)}`,head:branch,base:repo.default_branch,body:`تم التنفيذ بواسطة AI Engineering Agent.\\n\\nالطلب: ${command}\\n\\nالخطة: ${JSON.stringify(plan,null,2)}`})});
        setResult(`تم التنفيذ بأمان على فرع ${branch}. تم إنشاء Pull Request #${pr.number}. الفرع الأساسي لم يُمس.`);
        setLog(x=>[...x,"CHECKPOINT: تم إنشاء Pull Request."]);
        onDone();
      } else {
        setResult("الخطة الحالية لا تحتوي عملية تنفيذ مدعومة بعد. تحليل المستودع وتعديلات الكود ستكون في المرحلة التالية.");
      }
    } catch(e){ setResult(e instanceof Error?e.message:"فشل التنفيذ."); }
    finally{ setRunning(false); }
  };

  return <section className="mt-6 rounded-3xl border border-emerald-400/20 bg-emerald-500/5 p-5 sm:p-6">
    <div className="flex items-start gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-xl">🤖</div>
      <div><h2 className="text-xl font-bold">AI Engineering Agent</h2><p className="mt-1 text-sm text-slate-400">أمر واحد → تحليل → خطة → موافقة → فرع مستقل → تنفيذ → تحقق → Pull Request.</p></div>
    </div>
    <div className="mt-5 grid gap-3 md:grid-cols-4">
      <input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="OpenAI API Key" className="rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white" dir="ltr" />
      <input value={model} onChange={e=>setModel(e.target.value)} placeholder="gpt-5.6-luna" className="rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white" dir="ltr" />
      <select value={repoName} onChange={e=>setRepoName(e.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm" dir="ltr">{repos.map(r=><option key={r.id} value={r.full_name}>{r.full_name}</option>)}</select>
      <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/5 px-4 py-3 text-sm text-slate-300"><input type="file" accept=".zip,application/zip" onChange={e=>setZip(e.target.files?.[0]||null)} className="hidden" />{zip?`📦 ${zip.name}`:"اختيار ZIP من الهاتف"}</label>
    </div>
    <textarea value={command} onChange={e=>setCommand(e.target.value)} placeholder="مثال: ارفع هذا ZIP إلى houd11، افحصه، ولا تعدل الفرع الرئيسي." className="mt-3 min-h-28 w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white" />
    {manifest&&<div className="mt-2 text-xs text-slate-500" dir="ltr">{manifest}</div>}
    <div className="mt-3 flex flex-wrap gap-3">
      <button onClick={analyze} disabled={!apiKey.trim()||!command.trim()||!repoName||running} className="rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-600 px-5 py-3 font-semibold text-white disabled:opacity-40">{running?"جارٍ التحليل...":"1) تحليل وبناء الخطة"}</button>
      {plan&&<button onClick={()=>setApproved(!approved)} disabled={running} className={`rounded-xl border px-5 py-3 font-semibold ${approved?"border-emerald-400 bg-emerald-500/20 text-emerald-300":"border-amber-400/40 bg-amber-500/10 text-amber-200"}`}>{approved?"✓ تمت الموافقة":"2) أوافق على التنفيذ"}</button>}
      {plan&&<button onClick={execute} disabled={!approved||running} className="rounded-xl bg-gradient-to-r from-fuchsia-500 to-indigo-600 px-5 py-3 font-semibold text-white disabled:opacity-30">{running?"جارٍ التنفيذ...":"3) تنفيذ الخطة"}</button>}
    </div>
    {plan&&<div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm">
      <div className="font-semibold text-white">الخطة</div>
      <p className="mt-2 text-slate-300">{plan.summary||"—"}</p>
      <p className="mt-2 text-xs text-amber-300">مستوى المخاطر: {plan.risk||"غير محدد"} · التنفيذ لا يلمس الفرع الأساسي.</p>
      <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap text-xs text-slate-400" dir="ltr">{JSON.stringify(plan.actions||[],null,2)}</pre>
    </div>}
    {log.length>0&&<div className="mt-4 rounded-xl bg-black/20 p-3 text-xs text-slate-400">{log.map((x,i)=><div key={i}>{x}</div>)}</div>}
    {result&&<div className={`mt-4 rounded-xl border p-3 text-sm ${result.startsWith("تم التنفيذ")?"border-emerald-500/30 bg-emerald-500/10 text-emerald-300":"border-red-500/30 bg-red-500/10 text-red-300"}`}>{result}</div>}
    <p className="mt-3 text-xs text-amber-300/80">مفتاح OpenAI يبقى في المتصفح في هذه النسخة التجريبية. لا تمنح الوكيل صلاحية أوسع من المطلوب.</p>
  </section>;
}
