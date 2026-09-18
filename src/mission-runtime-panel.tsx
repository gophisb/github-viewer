import { useMemo, useState } from "react";

type Gate = "BLOCK" | "WARN" | "PASS";

type RuntimeProps = {
  repo: string;
  branch: string;
  sha: string;
  gate: Gate;
  onLog: (line: string) => void;
};

const API = "https://api.github.com";
const VERSION = "2022-11-28";

function getToken() {
  try { return localStorage.getItem("github-viewer-token") || ""; } catch { return ""; }
}

async function github<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("GitHub token غير موجود.");
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", VERSION);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(API + path, { ...init, headers });
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${await response.text()}`);
  if (response.status === 204) return {} as T;
  return response.json() as Promise<T>;
}

function splitRepo(repo: string) {
  const m = repo.match(/^([^/]+)\/([^/]+)$/);
  if (!m) throw new Error("صيغة المستودع يجب أن تكون owner/repo.");
  return m;
}

export default function MissionRuntimePanel({ repo, branch, sha, gate, onLog }: RuntimeProps) {
  const [open, setOpen] = useState(false);
  const [commitPath, setCommitPath] = useState("MISSION_CONTROL_RUNTIME_CHECKPOINT.md");
  const [commitText, setCommitText] = useState("Runtime checkpoint created by Mission Control.");
  const [commitConfirm, setCommitConfirm] = useState("");
  const [prTitle, setPrTitle] = useState("feat: activate governed engineering runtime");
  const [prBody, setPrBody] = useState("Created through Mission Control after verification gates.");
  const [deployConfirm, setDeployConfirm] = useState("");
  const [modelUrl, setModelUrl] = useState("");
  const [modelKey, setModelKey] = useState("");
  const [modelPrompt, setModelPrompt] = useState("حلّل هذه المهمة هندسياً ضمن RAECS، ولا تقترح أي إجراء يتجاوز مستوى الصلاحية المعطى.");
  const [modelOutput, setModelOutput] = useState("");
  const [agentResult, setAgentResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const blocked = gate === "BLOCK";
  const canWrite = gate === "PASS" && Boolean(repo && branch && sha);

  const roles = useMemo(() => [
    ["ARCHITECT", "يفهم البنية ويحدد حدود المهمة."],
    ["IMPLEMENTER", "يقترح/ينفذ التغيير المصرح فقط."],
    ["TESTER", "يطلب أدلة بناء واختبار مستقلة."],
    ["ADVERSARY", "يحاول كشف bypass أو scope creep."],
    ["REVIEWER", "يجمع الأدلة ولا يحول WARN إلى PASS."]
  ], []);

  const commitCheckpoint = async () => {
    if (!canWrite) { setStatus("BLOCK: لا يوجد PASS كامل أو SHA موثوق."); return; }
    if (commitConfirm !== "COMMIT") { setStatus("اكتب COMMIT للتأكيد."); return; }
    setBusy(true);
    try {
      const [owner, name] = splitRepo(repo);
      const existing = await fetch(`${API}/repos/${owner}/${name}/contents/${encodeURIComponent(commitPath)}?ref=${encodeURIComponent(branch)}`, {
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": VERSION, Authorization: `Bearer ${getToken()}` }
      });
      if (existing.ok) throw new Error("الملف موجود بالفعل؛ اختر مساراً جديداً حتى لا نكتب فوق عمل قائم.");
      const result = await github<any>(`/repos/${owner}/${name}/contents/${commitPath}`, {
        method: "PUT",
        body: JSON.stringify({ message: "chore: create governed runtime checkpoint", content: btoa(unescape(encodeURIComponent(commitText))), branch })
      });
      onLog(`L4 COMMIT → ${result.commit?.sha?.slice(0, 12) || "created"}`);
      setStatus("Commit تم إنشاؤه على الفرع الحالي.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "فشل commit."); }
    finally { setBusy(false); }
  };

  const openPR = async () => {
    if (!canWrite) { setStatus("BLOCK: لا يوجد PASS كامل."); return; }
    if (commitConfirm !== "PR") { setStatus("اكتب PR للتأكيد."); return; }
    setBusy(true);
    try {
      const [owner, name] = splitRepo(repo);
      const result = await github<any>(`/repos/${owner}/${name}/pulls`, {
        method: "POST",
        body: JSON.stringify({ title: prTitle, body: prBody, head: branch, base: "main", draft: true })
      });
      onLog(`L5 PR → #${result.number}`);
      setStatus(`Draft PR #${result.number} تم إنشاؤه.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "فشل إنشاء PR."); }
    finally { setBusy(false); }
  };

  const dispatchDeploy = async () => {
    if (gate !== "PASS") { setStatus("BLOCK: النشر يتطلب PASS."); return; }
    if (deployConfirm !== "DEPLOY MAIN") { setStatus("اكتب DEPLOY MAIN للتأكيد."); return; }
    setBusy(true);
    try {
      const [owner, name] = splitRepo(repo);
      await github<any>(`/repos/${owner}/${name}/actions/workflows/deploy.yml/dispatches`, {
        method: "POST",
        body: JSON.stringify({ ref: "main" })
      });
      onLog("L6 DEPLOY → workflow dispatch on main");
      setStatus("تم طلب GitHub Pages deployment من main.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "فشل طلب النشر."); }
    finally { setBusy(false); }
  };

  const runMultiAgent = () => {
    if (!repo || !sha) { setAgentResult("BLOCK: شغّل X-Ray أولاً."); return; }
    const lines = roles.map(([role, purpose]) => `[${role}] ${purpose}`);
    lines.push(`[GATE] gate=${gate} · branch=${branch} · sha=${sha.slice(0, 12)}`);
    lines.push(gate === "PASS" ? "[CONSENSUS] لا يوجد BLOCK؛ التنفيذ يجب أن يبقى داخل النطاق." : "[CONSENSUS] لا تنفيذ: الدليل غير كافٍ.");
    setAgentResult(lines.join("\n"));
    onLog("MULTI-AGENT → ARCHITECT / IMPLEMENTER / TESTER / ADVERSARY / REVIEWER");
  };

  const runModel = async () => {
    if (!modelUrl.trim()) { setStatus("أدخل endpoint متوافقاً مع OpenAI API."); return; }
    if (blocked) { setStatus("BLOCK: المراجعة تمنع تشغيل النموذج للتنفيذ."); return; }
    setBusy(true); setModelOutput("");
    try {
      const response = await fetch(modelUrl.trim(), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(modelKey ? { Authorization: `Bearer ${modelKey}` } : {}) },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "You are a bounded engineering agent. Never claim execution without evidence. Respect the supplied RAECS gate and scope." }, { role: "user", content: `${modelPrompt}\nRepo: ${repo}\nBranch: ${branch}\nSHA: ${sha}\nGate: ${gate}` }],
          temperature: 0.1
        })
      });
      if (!response.ok) throw new Error(`Model endpoint ${response.status}`);
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content || JSON.stringify(data);
      setModelOutput(String(content));
      onLog("MODEL AGENT → response received; no automatic tool execution.");
    } catch (error) { setModelOutput(error instanceof Error ? error.message : "فشل استدعاء النموذج."); }
    finally { setBusy(false); }
  };

  return <>
    <button onClick={() => setOpen(true)} className="fixed bottom-4 right-4 z-40 rounded-2xl border border-amber-400/30 bg-slate-950/95 px-4 py-3 text-sm font-bold text-amber-200 shadow-2xl backdrop-blur">⚙️ Runtime</button>
    {open && <div className="fixed inset-0 z-[60] bg-black/75 p-3 sm:p-6" onClick={() => setOpen(false)}>
      <div onClick={e => e.stopPropagation()} className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div><h2 className="font-bold">Governed Runtime</h2><p className="text-[11px] text-slate-500">Multi-Agent · Model Adapter · Commit · PR · Deploy</p></div>
          <button onClick={() => setOpen(false)} className="rounded-xl border border-white/10 px-3 py-2 text-sm">إغلاق</button>
        </div>
        <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 lg:grid-cols-2">
          <section className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <h3 className="font-semibold">L4 · Commit</h3>
              <p className="mt-1 text-xs text-slate-400">ينشئ ملف checkpoint جديداً على الفرع الحالي فقط.</p>
              <input value={commitPath} onChange={e => setCommitPath(e.target.value)} className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 p-2 text-xs" dir="ltr" />
              <textarea value={commitText} onChange={e => setCommitText(e.target.value)} className="mt-2 h-20 w-full rounded-xl border border-white/10 bg-black/30 p-2 text-xs" />
              <input value={commitConfirm} onChange={e => setCommitConfirm(e.target.value)} placeholder="اكتب COMMIT أو PR" className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-2 text-xs" />
              <button disabled={busy || !canWrite} onClick={commitCheckpoint} className="mt-2 w-full rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold disabled:opacity-40">إنشاء Commit</button>
              <button disabled={busy || !canWrite} onClick={openPR} className="mt-2 w-full rounded-xl border border-amber-400/30 px-3 py-2 text-xs disabled:opacity-40">إنشاء Draft PR</button>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <h3 className="font-semibold">L6 · Deploy</h3>
              <p className="mt-1 text-xs text-slate-400">يطلب workflow dispatch على main فقط. لا يتم النشر إذا كانت البوابة BLOCK/WARN.</p>
              <input value={deployConfirm} onChange={e => setDeployConfirm(e.target.value)} placeholder="اكتب DEPLOY MAIN" className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 p-2 text-xs" />
              <button disabled={busy || gate !== "PASS"} onClick={dispatchDeploy} className="mt-2 w-full rounded-xl bg-emerald-700 px-3 py-2 text-xs font-bold disabled:opacity-40">طلب النشر</button>
            </div>

            {status && <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-amber-200">{status}</div>}
          </section>

          <section className="space-y-4">
            <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
              <h3 className="font-semibold">Multi-Agent Council</h3>
              <div className="mt-3 space-y-1 text-xs">{roles.map(([role, purpose]) => <div key={role} className="rounded-lg bg-black/20 p-2"><b>{role}</b> · {purpose}</div>)}</div>
              <button onClick={runMultiAgent} className="mt-3 w-full rounded-xl border border-violet-400/30 px-3 py-2 text-xs">تشغيل المجلس</button>
              {agentResult && <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-slate-400">{agentResult}</pre>}
            </div>

            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
              <h3 className="font-semibold">Model-Backed Agent Adapter</h3>
              <p className="mt-1 text-xs text-slate-400">يدعم endpoint متوافقاً مع OpenAI Chat Completions. المفتاح يبقى في الذاكرة ولا يُحفظ في localStorage. النموذج لا يملك صلاحية GitHub تلقائياً.</p>
              <input value={modelUrl} onChange={e => setModelUrl(e.target.value)} placeholder="https://your-proxy.example/v1/chat/completions" className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 p-2 text-xs" dir="ltr" />
              <input value={modelKey} onChange={e => setModelKey(e.target.value)} placeholder="API key (memory only)" type="password" className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-2 text-xs" dir="ltr" />
              <textarea value={modelPrompt} onChange={e => setModelPrompt(e.target.value)} className="mt-2 h-20 w-full rounded-xl border border-white/10 bg-black/30 p-2 text-xs" />
              <button disabled={busy} onClick={runModel} className="mt-2 w-full rounded-xl bg-cyan-700 px-3 py-2 text-xs font-bold disabled:opacity-40">تشغيل النموذج</button>
              {modelOutput && <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-black/30 p-3 text-[11px] text-slate-300">{modelOutput}</pre>}
            </div>
          </section>
        </div>
      </div>
    </div>}
  </>;
}
