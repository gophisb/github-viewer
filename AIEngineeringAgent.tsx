import { useEffect, useMemo, useState } from "react";

type RepoLite = { id:number; full_name:string; default_branch:string };
declare global { interface Window { JSZip:any } }

const API="https://api.github.com";
const API_VERSION="2022-11-28";
const AI_KEY="github-viewer-openai-key";
const AI_MODEL_KEY="github-viewer-openai-model";
const MAX_FILES=8;
const MAX_FILE_CHARS=70000;
const MAX_TOTAL_CHARS=260000;

async function gh<T>(path:string, token:string, init:RequestInit={}):Promise<T>{
  const r=await fetch(path.startsWith("http")?path:API+path,{
    ...init,
    headers:{
      Accept:"application/vnd.github+json",
      "X-GitHub-Api-Version":API_VERSION,
      ...(token?{Authorization:`Bearer ${token}`}:{}),
      ...(init.body?{"Content-Type":"application/json"}:{})
    }
  });
  if(!r.ok) throw new Error((await r.text())||`GitHub API ${r.status}`);
  return r.status===204?({} as T):r.json();
}

async function ai(apiKey:string,model:string,input:string){
  const r=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{"Content-Type":"application/json",Authorization:`Bearer ${apiKey}`},
    body:JSON.stringify({model,input,max_output_tokens:14000})
  });
  if(!r.ok) throw new Error((await r.text())||`OpenAI API ${r.status}`);
  const d=await r.json();
  if(typeof d.output_text==="string") return d.output_text;
  return (d.output||[]).flatMap((x:any)=>x.content||[]).map((x:any)=>x.text||"").join("\n");
}

function jsonFrom(text:string){
  const clean=text.replace(/^\s*```json\s*/i,"").replace(/\s*```\s*$/,"").trim();
  const a=clean.indexOf("{"),b=clean.lastIndexOf("}");
  if(a<0||b<a) throw new Error("لم يُرجع الذكاء الاصطناعي JSON صالحًا.");
  return JSON.parse(clean.slice(a,b+1));
}

function safePath(p:string){
  const x=p.replace(/\\/g,"/").replace(/^\/+/,"");
  if(!x||x.split("/").some((part:string)=>!part||part===".."||part===".")) throw new Error(`مسار غير آمن: ${p}`);
  const blocked=/^(\.github\/workflows\/|\.env|.*\.pem$|.*\.key$|.*secret.*|.*credential.*)/i;
  if(blocked.test(x)) throw new Error(`المسار محمي ولا يمكن للوكيل تعديله: ${x}`);
  return x;
}

function decodeContent(content:string){
  if(!content) return "";
  const bin=atob(content.replace(/\n/g,""));
  return new TextDecoder().decode(Uint8Array.from(bin,(c)=>c.charCodeAt(0)));
}


async function ghText(path:string, token:string){
  const r=await fetch(path.startsWith("http")?path:API+path,{headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":API_VERSION,...(token?{Authorization:`Bearer ${token}`}: {})}});
  if(!r.ok) throw new Error((await r.text())||`GitHub API ${r.status}`);
  return r.text();
}
async function getCIReport(repo:string,sha:string,token:string){
  const runs=await gh<any>(`/repos/${repo}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=10`,token).catch(()=>({workflow_runs:[]}));
  const workflowRuns=(runs.workflow_runs||[]).slice(0,10); const jobs:any[]=[];
  for(const run of workflowRuns.slice(0,5)){
    const jr=await gh<any>(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`,token).catch(()=>({jobs:[]}));
    for(const job of (jr.jobs||[])) if(job.conclusion && job.conclusion!=="success"){
      let logs=""; try{logs=await ghText(`/repos/${repo}/actions/jobs/${job.id}/logs`,token);}catch{}
      jobs.push({run_id:run.id,run_name:run.name,run_url:run.html_url,job_id:job.id,name:job.name,status:job.status,conclusion:job.conclusion,steps:job.steps||[],logs:String(logs).slice(-18000)});
    }
  }
  const all=await gh<any>(`/repos/${repo}/commits/${sha}/check-runs`,token).catch(()=>({check_runs:[]}));
  const checks=(all.check_runs||[]).map((x:any)=>({name:x.name,status:x.status,conclusion:x.conclusion,details_url:x.details_url}));
  const pending=checks.some((x:any)=>x.status!=="completed")||workflowRuns.some((x:any)=>["queued","in_progress","waiting","requested","pending"].includes(x.status));
  const failed=checks.some((x:any)=>x.status==="completed"&&!["success","neutral","skipped"].includes(x.conclusion||""))||workflowRuns.some((x:any)=>["failure","timed_out","cancelled","action_required"].includes(x.conclusion||""))||jobs.some((x:any)=>x.conclusion!=="success");
  return {checks,workflowRuns,jobs,pending,failed};
}
async function waitForCI(repo:string,sha:string,token:string,maxPolls=12){
  let last:any={checks:[],workflowRuns:[],jobs:[],pending:true,failed:false};
  for(let i=0;i<maxPolls;i++){ await new Promise(r=>setTimeout(r,4000)); last=await getCIReport(repo,sha,token); if((last.checks.length||last.workflowRuns.length)&&!last.pending)return last; }
  return last;
}

function fileRef(repo:string,path:string,ref:string){
  return `/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`;
}

export default function AIEngineeringAgent({repos,token,onDone}:{repos:RepoLite[];token:string;onDone:()=>void}){
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
  const [branch,setBranch]=useState("");

  useEffect(()=>{if(!repoName&&repos[0])setRepoName(repos[0].full_name)},[repos,repoName]);

  const manifest=useMemo(()=>zip?`ZIP: ${zip.name} | ${Math.round(zip.size/1024)} KB`:"",[zip]);

  const pushLog=(s:string)=>setLog(x=>[...x,s]);

  const analyze=async()=>{
    if(!apiKey.trim()||!command.trim()||!repoName||running)return;
    const repo=repos.find(r=>r.full_name===repoName);
    if(!repo)return;
    setRunning(true);setResult("");setPlan(null);setApproved(false);setLog(["ASSESS: فهم الطلب وتحديد حدود التنفيذ..."]);
    localStorage.setItem(AI_KEY,apiKey.trim());localStorage.setItem(AI_MODEL_KEY,model.trim());
    try{
      let zipInfo=manifest;
      const tree=await gh<any>(`/repos/${repo.full_name}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`,token);
      const repoPaths=(tree.tree||[]).filter((x:any)=>x.type==="blob"&&typeof x.path==="string").slice(0,1800).map((x:any)=>x.path);
      const repoMap="\\nREPOSITORY FILE MAP:\\n"+repoPaths.join("\\n");
      if(zip){
        if(!window.JSZip)throw new Error("محرك ZIP غير جاهز؛ أعد تحميل الصفحة.");
        const z=await window.JSZip.loadAsync(zip);
        const names=Object.values(z.files).filter((x:any)=>!x.dir).map((x:any)=>String(x.name).replace(/\\/g,"/")).slice(0,500);
        zipInfo+="\nFILES:\n"+names.join("\n");
      }
      const prompt=`أنت مهندس برمجيات مسؤول داخل GitHub Viewer.
المستودع: ${repo.full_name}
الفرع الأساسي: ${repo.default_branch}
طلب المستخدم: ${command}
ZIP: ${zipInfo||"لا يوجد"}
${repoMap}

هدفك بناء خطة هندسية قابلة للتنفيذ، لا تنفيذها الآن.
أعد JSON فقط:
{"summary":"...","risk":"low|medium|high","actions":[{"type":"inspect_repo|modify_repo|upload_zip","reason":"...","paths":["..."],"target_folder":""}]}

قواعد صارمة:
- inspect_repo تعني اختيار ملفات قليلة مرتبطة مباشرة بالطلب لفحصها.
- modify_repo تعني قراءة الملفات أولًا ثم تعديلها على فرع مستقل وفتح PR.
- لا حذف ملفات، ولا تعديل أسرار أو مفاتيح أو .env أو GitHub Actions.
- لا تستخدم مسارات .. أو مسارات مطلقة.
- الحد الأقصى ${MAX_FILES} ملفات تعديل.
- إذا لم يوجد ZIP فلا تستخدم upload_zip.
- لا تفترض أسماء ملفات غير منطقية؛ اختر مسارات مرجحة فقط.`;
      pushLog("PLAN: بناء خطة منظمة...");
      setPlan(jsonFrom(await ai(apiKey.trim(),model.trim(),prompt)));
      pushLog("PLAN: اكتملت الخطة؛ التنفيذ متوقف حتى موافقة المستخدم.");
    }catch(e){setResult(e instanceof Error?e.message:"فشل التحليل.");}
    finally{setRunning(false)}
  };

  const execute=async()=>{
    if(!plan||!approved||running)return;
    const repo=repos.find(r=>r.full_name===repoName);
    if(!repo)return;
    setRunning(true);setResult("");
    try{
      const base=await gh<any>(`/repos/${repo.full_name}/git/ref/heads/${repo.default_branch}`,token);
      const baseSha=base.object.sha;
      const newBranch=`ai-agent/${Date.now()}`;
      setBranch(newBranch);
      pushLog(`ISOLATE: إنشاء فرع مستقل ${newBranch}`);
      await gh(`/repos/${repo.full_name}/git/refs`,token,{method:"POST",body:JSON.stringify({ref:`refs/heads/${newBranch}`,sha:baseSha})});

      const upload=plan.actions?.find((a:any)=>a.type==="upload_zip");
      if(upload){
        if(!zip)throw new Error("الخطة تطلب ZIP لكن الملف غير موجود.");
        if(!window.JSZip)throw new Error("محرك ZIP غير جاهز.");
        const z=await window.JSZip.loadAsync(zip);
        const entries=Object.values(z.files).filter((x:any)=>!x.dir) as any[];
        if(!entries.length)throw new Error("ZIP فارغ.");
        const folder=String(upload.target_folder||"").replace(/^\/+|\/+$/g,"");
        const tree:any[]=[];
        for(let i=0;i<entries.length;i++){
          const raw=safePath(String(entries[i].name));
          const path=[folder,raw].filter(Boolean).join("/");
          pushLog(`UPLOAD: ${i+1}/${entries.length} ${path}`);
          const blob=await gh<any>(`/repos/${repo.full_name}/git/blobs`,token,{method:"POST",body:JSON.stringify({content:await entries[i].async("base64"),encoding:"base64"})});
          tree.push({path,mode:"100644",type:"blob",sha:blob.sha});
        }
        const parent=await gh<any>(`/repos/${repo.full_name}/git/commits/${baseSha}`,token);
        const t=await gh<any>(`/repos/${repo.full_name}/git/trees`,token,{method:"POST",body:JSON.stringify({base_tree:parent.tree.sha,tree})});
        const c=await gh<any>(`/repos/${repo.full_name}/git/commits`,token,{method:"POST",body:JSON.stringify({message:`AI Agent: ${command.slice(0,72)}`,tree:t.sha,parents:[baseSha]})});
        await gh(`/repos/${repo.full_name}/git/refs/heads/${newBranch}`,token,{method:"PATCH",body:JSON.stringify({sha:c.sha,force:false})});
        pushLog("VERIFY: التحقق من رأس الفرع...");
        await gh(`/repos/${repo.full_name}/git/ref/heads/${newBranch}`,token);
        pushLog("CI: انتظار الفحوص على commit الفرع...");
        const uploadCompare=await gh<any>(`/repos/${repo.full_name}/compare/${encodeURIComponent(repo.default_branch)}...${encodeURIComponent(newBranch)}`,token);
        const uploadHeadSha=uploadCompare.head?.sha||c.sha;
        const uploadCI=await waitForCI(repo.full_name,uploadHeadSha,token,10);
        const uploadCIText=uploadCI.checks.map((x:any)=>`${x.name}: ${x.status}/${x.conclusion||"pending"}`).join("\n")||"لا توجد فحوص مسجلة.";
        const uploadPR=await gh<any>(`/repos/${repo.full_name}/pulls`,token,{method:"POST",body:JSON.stringify({title:`AI Agent: ${command.slice(0,72)}`,head:newBranch,base:repo.default_branch,body:`طلب المستخدم:\n${command}\n\nالخطة:\n${JSON.stringify(plan,null,2)}\n\nCI:\n${uploadCIText}\n\n> الفرع الأساسي لم يُمس. لا دمج تلقائي.`})});
        setResult(`تم رفع ZIP على فرع ${newBranch} وإنشاء Pull Request #${uploadPR.number}.\nCI: ${uploadCIText}`);
        if(uploadCI.failed)pushLog("CI: فشل؛ SAFE-STOP. لا إصلاح تلقائي للـZIP.");
        else pushLog("CHECKPOINT: PR جاهز للمراجعة.");
        onDone();return;
      }

      const inspect=plan.actions?.filter((a:any)=>a.type==="inspect_repo"||a.type==="modify_repo")||[];
      const requested=[...new Set(inspect.flatMap((a:any)=>Array.isArray(a.paths)?a.paths:[]))].slice(0,MAX_FILES).map((p:string)=>safePath(p));
      if(!requested.length)throw new Error("الخطة لا تحدد ملفات للفحص. أعد التحليل بطلب أكثر تحديدًا.");
      let context="";let total=0;
      for(const path of requested){
        pushLog(`READ: ${path}`);
        const f=await gh<any>(fileRef(repo.full_name,path,repo.default_branch),token);
        if(f.type!=="file")continue;
        const text=decodeContent(f.content||"");
        const clipped=text.slice(0,MAX_FILE_CHARS);
        total+=clipped.length;
        if(total>MAX_TOTAL_CHARS)break;
        context+=`\n===== FILE: ${path} =====\n${clipped}\n===== END FILE =====\n`;
      }

      const wantsModify=inspect.some((a:any)=>a.type==="modify_repo");
      const second=`أنت الآن في مرحلة ${wantsModify?"التعديل":"الفحص"}.
المستودع: ${repo.full_name}
طلب المستخدم: ${command}
الملفات التي قرأها الوكيل:
${context}

${wantsModify?`أعد JSON فقط:
{"summary":"...","changes":[{"path":"...","content":"المحتوى الكامل الجديد","reason":"..."}],"verification":["..."]}
قواعد:
- غيّر فقط الملفات التي قُرئت أعلاه.
- لا حذف.
- لا أسرار ولا .env ولا GitHub Actions.
- الحد الأقصى ${MAX_FILES} تغييرات.
- يجب أن يكون content كامل الملف، لا diff ولا اختصار.
- إذا لم يكن التعديل آمنًا أو لا توجد معلومات كافية فأعد changes: [] واذكر السبب.`:`أعد JSON فقط:
{"summary":"...","findings":[{"path":"...","finding":"...","severity":"low|medium|high"}],"verification":["..."]}
لا تقترح تعديلات.`}`;
      pushLog("REVIEW: إرسال الملفات المقروءة للتحليل الهندسي...");
      const decision=jsonFrom(await ai(apiKey.trim(),model.trim(),second));

      if(!wantsModify){
        setResult(JSON.stringify(decision,null,2));pushLog("VERIFY: اكتمل الفحص؛ لم تُجر أي تغييرات.");return;
      }

      const changes=Array.isArray(decision.changes)?decision.changes:[];
      if(changes.length>MAX_FILES)throw new Error(`الخطة حاولت تعديل أكثر من ${MAX_FILES} ملفات.`);
      if(!changes.length){setResult(decision.summary||"لم يجد الوكيل تعديلاً آمنًا.");return;}

      const changedPaths:string[]=[];
      for(const ch of changes){
        const path=safePath(String(ch.path||""));
        if(!requested.includes(path))throw new Error(`محاولة تعديل ملف لم تتم قراءته: ${path}`);
        const content=String(ch.content??"");
        if(!content)throw new Error(`محتوى فارغ للملف: ${path}`);
        pushLog(`MODIFY: ${path}`);
        const existing=await gh<any>(fileRef(repo.full_name,path,newBranch),token);
        await gh<any>(`/repos/${repo.full_name}/contents/${path}`,token,{
          method:"PUT",
          body:JSON.stringify({message:`AI Agent: ${command.slice(0,60)}`,content:btoa(unescape(encodeURIComponent(content))),sha:existing.sha,branch:newBranch})
        });
        changedPaths.push(path);
      }

      pushLog("VERIFY: إعادة قراءة الملفات المعدلة من الفرع...");
      for(const path of changedPaths){
        const f=await gh<any>(fileRef(repo.full_name,path,newBranch),token);
        if(f.type!=="file"||!f.sha)throw new Error(`فشل التحقق من الملف: ${path}`);
      }

      const compare=await gh<any>(`/repos/${repo.full_name}/compare/${encodeURIComponent(repo.default_branch)}...${newBranch}`,token);
      const stats=(compare.files||[]).map((f:any)=>`${f.filename}: +${f.additions||0} / -${f.deletions||0}`).join("\n");
      pushLog(`DIFF: ${changedPaths.length} ملفات؛ ${compare.total_commits||0} commits`);

      let ci="لم يتم العثور على فحوص CI مرتبطة بعد.";
      let ciReport:any=null;
      const headSha=compare.head?.sha||"";
      if(headSha){ pushLog("CI: انتظار اكتمال الفحوص..."); ciReport=await waitForCI(repo.full_name,headSha,token,12); ci=ciReport.checks.map((x:any)=>`${x.name}: ${x.status}/${x.conclusion||"pending"}`).join("\n")||"لا توجد فحوص مسجلة."; }

      const changedForRepair=[...changedPaths]; const repairHistory:string[]=[]; const MAX_REPAIR_CYCLES=2;
      for(let cycle=1;cycle<=MAX_REPAIR_CYCLES && ciReport?.failed;cycle++){
        pushLog(`REPAIR: دورة إصلاح ${cycle}/${MAX_REPAIR_CYCLES}`);
        const failureEvidence=(ciReport.jobs||[]).map((j:any)=>`JOB ${j.name} [${j.conclusion}]\n${j.logs||"(لا توجد سجلات متاحة)"}`).join("\n\n").slice(0,36000);
        let repairContext="";
        for(const path of [...new Set(changedForRepair)].slice(0,MAX_FILES)){ const f=await gh<any>(fileRef(repo.full_name,path,newBranch),token); repairContext+=`\n===== CURRENT FILE: ${path} =====\n${decodeContent(f.content||"").slice(0,MAX_FILE_CHARS)}\n===== END FILE =====\n`; }
        const repairPrompt=`أنت مهندس إصلاح CI داخل وكيل هندسي محكوم.
طلب المستخدم: ${command}
المستودع: ${repo.full_name}
الفرع: ${newBranch}
نتيجة الفحوص:
${ci}
أدلة الوظائف الفاشلة:
${failureEvidence}
الملفات الحالية على الفرع:
${repairContext}

أعد JSON فقط:
{"summary":"...","changes":[{"path":"...","content":"المحتوى الكامل الجديد","reason":"..."}],"verification":["..."]}
قواعد صارمة:
- أصلح السبب المثبت من الأدلة فقط؛ لا تخمّن.
- غيّر فقط ملفات موجودة في السياق.
- لا حذف، لا أسرار، لا .env، لا .github/workflows.
- الحد الأقصى ${MAX_FILES} ملفات.
- المحتوى كامل الملف.
- إذا لم يمكن إصلاح المشكلة بأمان: changes: [].
- لا تغيّر بنية المشروع بلا ضرورة.`;
        const repair=jsonFrom(await ai(apiKey.trim(),model.trim(),repairPrompt)); repairHistory.push(`الدورة ${cycle}: ${repair.summary||"—"}`);
        const repairChanges=Array.isArray(repair.changes)?repair.changes:[];
        if(!repairChanges.length){ pushLog("REPAIR: لا يوجد إصلاح آمن؛ SAFE-STOP."); break; }
        if(repairChanges.length>MAX_FILES)throw new Error("الإصلاح تجاوز الحد المسموح.");
        for(const ch of repairChanges){
          const path=safePath(String(ch.path||"")); if(!changedForRepair.includes(path))throw new Error(`إصلاح خارج نطاق الملفات المقروءة: ${path}`);
          const content=String(ch.content??""); if(!content)throw new Error(`محتوى إصلاح فارغ: ${path}`);
          const existing=await gh<any>(fileRef(repo.full_name,path,newBranch),token);
          await gh<any>(`/repos/${repo.full_name}/contents/${path}`,token,{method:"PUT",body:JSON.stringify({message:`AI Agent repair ${cycle}: ${command.slice(0,50)}`,content:btoa(unescape(encodeURIComponent(content))),sha:existing.sha,branch:newBranch})});
          pushLog(`REPAIR: تم تعديل ${path}`);
        }
        const verifyCompare=await gh<any>(`/repos/${repo.full_name}/compare/${encodeURIComponent(repo.default_branch)}...${encodeURIComponent(newBranch)}`,token);
        const newHead=verifyCompare.head?.sha; if(!newHead)throw new Error("تعذر تحديد commit الإصلاح.");
        for(const path of repairChanges.map((x:any)=>safePath(String(x.path||"")))){ const f=await gh<any>(fileRef(repo.full_name,path,newBranch),token); if(f.type!=="file"||!f.sha)throw new Error(`فشل التحقق بعد الإصلاح: ${path}`); }
        pushLog("CI: إعادة الاختبار بعد الإصلاح..."); ciReport=await waitForCI(repo.full_name,newHead,token,12); ci=ciReport.checks.map((x:any)=>`${x.name}: ${x.status}/${x.conclusion||"pending"}`).join("\n")||"لا توجد فحوص مسجلة.";
      }

      const finalCompare=await gh<any>(`/repos/${repo.full_name}/compare/${encodeURIComponent(repo.default_branch)}...${encodeURIComponent(newBranch)}`,token);
      const finalStats=(finalCompare.files||[]).map((f:any)=>`${f.filename}: +${f.additions||0} / -${f.deletions||0}`).join("\n");
      const repairText=repairHistory.length?repairHistory.join("\n"):"لم تُستخدم دورة إصلاح.";
      const finalStatus=ciReport?.failed?"CI ما زال فاشلًا بعد الحد الأقصى؛ SAFE-STOP.":(ciReport?.pending?"CI ما زال قيد التشغيل؛ المراجعة اليدوية مطلوبة.":"CI مكتمل دون فشل معروف.");
      const pr=await gh<any>(`/repos/${repo.full_name}/pulls`,token,{method:"POST",body:JSON.stringify({title:`AI Agent: ${command.slice(0,72)}`,head:newBranch,base:repo.default_branch,body:`## AI Engineering Agent\n\n**الطلب:**\n${command}\n\n**الخطة:**\n${decision.summary||plan.summary||"—"}\n\n**الملفات:**\n${[...new Set(changedForRepair)].map((x:string)=>`- ${x}`).join("\n")}\n\n**Diff:**\n${finalStats||"—"}\n\n**CI:**\n${ci}\n\n**الحالة:**\n${finalStatus}\n\n**الإصلاحات:**\n${repairText}\n\n> لم يتم تعديل الفرع الأساسي. لا يوجد دمج تلقائي؛ القرار البشري مطلوب.`})});
      setResult(`اكتمل التنفيذ على ${newBranch}. PR #${pr.number}.\n${finalStatus}\n\n${finalStats||"لا توجد إحصاءات diff."}`);
      if(ciReport?.failed)pushLog("SAFE-STOP: CI ما زال فاشلًا؛ لم يتم الدمج.");
      else pushLog("CHECKPOINT: التنفيذ والتحقق وCI اكتملوا؛ الـPR ينتظر المراجعة البشرية.");
      onDone();
    }catch(e){setResult(e instanceof Error?e.message:"فشل التنفيذ.");pushLog("SAFE-STOP: توقف التنفيذ عند أول خطأ.");}
    finally{setRunning(false)}
  };

  return <section className="mt-6 rounded-3xl border border-emerald-400/20 bg-emerald-500/5 p-5 sm:p-6">
    <div className="flex items-start gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-xl">🤖</div>
      <div><h2 className="text-xl font-bold">AI Engineering Agent</h2><p className="mt-1 text-sm text-slate-400">ASSESS → PLAN → READ → MODIFY → VERIFY → DIFF → PR. الفرع الأساسي محمي.</p></div>
    </div>
    <div className="mt-5 grid gap-3 md:grid-cols-4">
      <input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="OpenAI API Key" className="rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white" dir="ltr"/>
      <input value={model} onChange={e=>setModel(e.target.value)} placeholder="gpt-5.6-luna" className="rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white" dir="ltr"/>
      <select value={repoName} onChange={e=>setRepoName(e.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm" dir="ltr">{repos.map(r=><option key={r.id} value={r.full_name}>{r.full_name}</option>)}</select>
      <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/5 px-4 py-3 text-sm text-slate-300"><input type="file" accept=".zip,application/zip" onChange={e=>setZip(e.target.files?.[0]||null)} className="hidden"/>{zip?`📦 ${zip.name}`:"اختيار ZIP من الهاتف"}</label>
    </div>
    <textarea value={command} onChange={e=>setCommand(e.target.value)} placeholder="مثال: افحص houd11، أصلح مشكلة الأذان، اقرأ الملفات المرتبطة فقط ثم نفّذ الإصلاح على فرع مستقل وأنشئ PR." className="mt-3 min-h-28 w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white"/>
    {manifest&&<div className="mt-2 text-xs text-slate-500" dir="ltr">{manifest}</div>}
    <div className="mt-3 flex flex-wrap gap-3">
      <button onClick={analyze} disabled={!apiKey.trim()||!command.trim()||!repoName||running} className="rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-600 px-5 py-3 font-semibold text-white disabled:opacity-40">{running?"جارٍ العمل...":"1) تحليل وبناء الخطة"}</button>
      {plan&&<button onClick={()=>setApproved(!approved)} disabled={running} className={`rounded-xl border px-5 py-3 font-semibold ${approved?"border-emerald-400 bg-emerald-500/20 text-emerald-300":"border-amber-400/40 bg-amber-500/10 text-amber-200"}`}>{approved?"✓ تمت الموافقة":"2) أوافق على التنفيذ"}</button>}
      {plan&&<button onClick={execute} disabled={!approved||running} className="rounded-xl bg-gradient-to-r from-fuchsia-500 to-indigo-600 px-5 py-3 font-semibold text-white disabled:opacity-30">{running?"جارٍ التنفيذ...":"3) تنفيذ الخطة"}</button>}
    </div>
    {branch&&<div className="mt-3 rounded-xl bg-black/20 p-3 text-xs text-slate-400" dir="ltr">Branch: {branch}</div>}
    {plan&&<div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm">
      <div className="font-semibold text-white">الخطة</div><p className="mt-2 text-slate-300">{plan.summary||"—"}</p>
      <p className="mt-2 text-xs text-amber-300">المخاطر: {plan.risk||"غير محددة"} · لا حذف · لا أسرار · لا تعديل للفرع الأساسي.</p>
      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-slate-400" dir="ltr">{JSON.stringify(plan.actions||[],null,2)}</pre>
    </div>}
    {log.length>0&&<div className="mt-4 max-h-48 overflow-auto rounded-xl bg-black/20 p-3 text-xs text-slate-400">{log.map((x,i)=><div key={i}>{x}</div>)}</div>}
    {result&&<pre className={`mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border p-3 text-sm ${result.startsWith("تم")||result.includes("اكتمل")?"border-emerald-500/30 bg-emerald-500/10 text-emerald-300":"border-red-500/30 bg-red-500/10 text-red-300"}`}>{result}</pre>}
    <p className="mt-3 text-xs text-amber-300/80">هذه نسخة تجريبية: مفتاح OpenAI يبقى في المتصفح. الوكيل لا يحصل على مفتاح GitHub داخل النموذج؛ لكنه يستخدمه لتنفيذ عمليات GitHub من المتصفح. لا تمنحه صلاحيات أوسع من المطلوب.</p>
  </section>;
}
