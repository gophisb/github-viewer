import { useMemo, useState } from "react";

type XRay = {
  repo: string;
  branch: string;
  sha: string;
  files: string[];
  truncated: boolean;
  stack: string[];
  entryPoints: string[];
  ci: string[];
  sensitive: string[];
  dependencies: string[];
  riskFlags: string[];
};

type Evidence = {
  id: string;
  label: string;
  status: "PASS" | "WARN" | "BLOCK";
  detail: string;
};

type Memory = {
  taskLedger: string[];
  decisions: string[];
  checkpoints: string[];
};

const API = "https://api.github.com";
const VERSION = "2022-11-28";
const MEMORY_KEY = "github-mission-control-memory-v1";

function token() {
  try { return localStorage.getItem("github-viewer-token") || ""; } catch { return ""; }
}

async function gh<T>(path: string): Promise<T> {
  const t = token();
  const res = await fetch(API + path, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": VERSION,
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json() as Promise<T>;
}

function loadMemory(): Memory {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { taskLedger: [], decisions: [], checkpoints: [] };
}

function saveMemory(m: Memory) {
  try { localStorage.setItem(MEMORY_KEY, JSON.stringify(m)); } catch {}
}

function detectStack(files: string[]) {
  const f = new Set(files);
  const out: string[] = [];
  if (f.has("package.json")) out.push("Node.js / JavaScript");
  if (f.has("tsconfig.json") || files.some(x => x.endsWith(".ts") || x.endsWith(".tsx"))) out.push("TypeScript");
  if (f.has("vite.config.ts") || f.has("vite.config.js")) out.push("Vite");
  if (f.has("next.config.js") || f.has("next.config.mjs") || f.has("next.config.ts")) out.push("Next.js");
  if (f.has("requirements.txt") || f.has("pyproject.toml")) out.push("Python");
  if (f.has("Dockerfile")) out.push("Docker");
  if (files.some(x => x.startsWith(".github/workflows/"))) out.push("GitHub Actions");
  if (f.has("android") || files.some(x => x.startsWith("android/"))) out.push("Android");
  return out;
}

function analyze(repo: string, branch: string, data: any): XRay {
  const files = (data.tree || []).map((x: any) => x.path).filter(Boolean);
  const sensitive = files.filter((p: string) => /(^|\/)(\.env|\.env\.|.*\.pem$|.*\.key$|credentials?\.|secrets?\.)/i.test(p));
  const ci = files.filter((p: string) => p.startsWith(".github/workflows/"));
  const entryPoints = files.filter((p: string) => /(^|\/)(main|index|App)\.(tsx?|jsx?|py|kt|java)$/.test(p)).slice(0, 20);
  const dependencies = files.filter((p: string) => /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|Cargo\.toml|go\.mod|build\.gradle.*)$/.test(p));
  const riskFlags: string[] = [];
  if (data.truncated) riskFlags.push("شجرة المستودع مبتورة؛ التحليل ليس كاملاً.");
  if (sensitive.length) riskFlags.push("ملفات قد تحتوي أسراراً/بيانات حساسة ظهرت في الشجرة؛ لم تُقرأ محتوياتها.");
  if (!ci.length) riskFlags.push("لم يتم العثور على GitHub Actions workflow.");
  if (!entryPoints.length) riskFlags.push("لم يتم تحديد نقطة دخول واضحة.");
  return { repo, branch, sha: data.sha || "", files, truncated: !!data.truncated, stack: detectStack(files), entryPoints, ci, sensitive, dependencies, riskFlags };
}

function buildEvidence(x: XRay): Evidence[] {
  return [
    { id: "XRAY-001", label: "الوصول إلى المستودع", status: x.sha ? "PASS" : "BLOCK", detail: x.sha ? `HEAD ${x.sha.slice(0, 12)}` : "لا يوجد SHA موثوق." },
    { id: "XRAY-002", label: "فحص شجرة الملفات", status: x.files.length ? (x.truncated ? "WARN" : "PASS") : "BLOCK", detail: `${x.files.length} مساراً مكتشفاً${x.truncated ? " مع truncation" : ""}.` },
    { id: "XRAY-003", label: "اكتشاف التقنية", status: x.stack.length ? "PASS" : "WARN", detail: x.stack.join(" · ") || "لم يتم اكتشاف stack واضح." },
    { id: "SEC-001", label: "مؤشرات ملفات حساسة", status: x.sensitive.length ? "WARN" : "PASS", detail: x.sensitive.length ? `${x.sensitive.length} مساراً يحتاج مراجعة.` : "لا توجد أسماء ملفات حساسة معروفة في الشجرة." },
    { id: "CI-001", label: "CI/CD", status: x.ci.length ? "PASS" : "WARN", detail: x.ci.length ? `${x.ci.length} workflow(s).` : "لا توجد workflows مكتشفة." },
    { id: "GATE-001", label: "بوابة الادعاء", status: x.truncated || x.sensitive.length ? "WARN" : "PASS", detail: x.truncated ? "لا يسمح هذا الفحص بادعاء اكتمال التحليل." : "الأدلة الحالية كافية لعرض تحليل أولي فقط؛ ليست إثباتاً لبناء أو اختبار." },
  ];
}

export default function MissionControl() {
  const [open, setOpen] = useState(false);
  const [repoInput, setRepoInput] = useState("");
  const [xray, setXray] = useState<XRay | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [busy, setBusy] = useState(false);
  const [agentLog, setAgentLog] = useState<string[]>([]);
  const [level, setLevel] = useState(1);
  const [memory, setMemory] = useState<Memory>(loadMemory());
  const [task, setTask] = useState("");
  const [message, setMessage] = useState("");
  const [ciStatus, setCiStatus] = useState<string>("NOT_CHECKED");

  const gate = useMemo(() => {
    if (!evidence.length) return "NOT_RUN";
    if (evidence.some(e => e.status === "BLOCK")) return "BLOCK";
    if (evidence.some(e => e.status === "WARN")) return "REVIEW";
    return "PASS";
  }, [evidence]);

  const verifyCI = async () => {
    if (!xray?.sha) { setMessage("شغّل X-Ray أولاً."); return; }
    setBusy(true); setMessage("");
    try {
      const ownerRepo = xray.repo;
      const data = await gh<any>(`/repos/${ownerRepo}/actions/runs?head_sha=${encodeURIComponent(xray.sha)}&per_page=20`);
      const runs = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
      if (!runs.length) {
        setCiStatus("NO_RUN");
        setEvidence(prev => [...prev.filter(e => e.id !== "CI-002"), {
          id: "CI-002", label: "GitHub Actions evidence", status: "WARN",
          detail: "لا توجد workflow run مرتبطة بهذا SHA؛ لا يمكن إثبات build/test من هذه النقطة."
        }]);
        return;
      }
      const completed = runs.find((r: any) => r.status === "completed");
      if (!completed) {
        setCiStatus("IN_PROGRESS");
        setEvidence(prev => [...prev.filter(e => e.id !== "CI-002"), {
          id: "CI-002", label: "GitHub Actions evidence", status: "WARN",
          detail: `Workflow موجودة لكن لم تكتمل بعد: ${runs[0].name || "CI"}.`
        }]);
        return;
      }
      const passed = completed.conclusion === "success";
      setCiStatus(completed.conclusion || completed.status);
      setEvidence(prev => [...prev.filter(e => e.id !== "CI-002"), {
        id: "CI-002", label: "GitHub Actions evidence", status: passed ? "PASS" : "BLOCK",
        detail: `${completed.name || "CI"} · ${completed.conclusion} · run #${completed.run_number ?? "?"} · SHA ${xray.sha.slice(0, 12)}`
      }]);
      setAgentLog(prev => [...prev, `VERIFY → CI ${passed ? "PASS" : "BLOCK"} · ${completed.name || "workflow"}`]);
    } catch (e) {
      setCiStatus("ERROR");
      setEvidence(prev => [...prev.filter(e => e.id !== "CI-002"), {
        id: "CI-002", label: "GitHub Actions evidence", status: "WARN",
        detail: "تعذر قراءة GitHub Actions؛ لم يتم تحويل الفشل إلى PASS."
      }]);
      setMessage(e instanceof Error ? e.message : "فشل التحقق من CI.");
    } finally { setBusy(false); }
  };

  const inspect = async () => {
    const value = repoInput.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
    const match = value.match(/^([^/]+)\/([^/]+)$/);
    if (!match) { setMessage("أدخل owner/repo مثل gophisb/github-viewer."); return; }
    setBusy(true); setMessage(""); setAgentLog([]);
    try {
      setAgentLog(["L1 ANALYZE → GET repository metadata", "L1 ANALYZE → GET recursive Git tree"]);
      const meta = await gh<any>(`/repos/${match[1]}/${match[2]}`);
      const tree = await gh<any>(`/repos/${match[1]}/${match[2]}/git/trees/${encodeURIComponent(meta.default_branch)}?recursive=1`);
      const result = analyze(value, meta.default_branch, tree);
      const ev = buildEvidence(result);
      setXray(result); setEvidence(ev);
      setAgentLog(prev => [...prev, `VERIFY → ${ev.filter(e => e.status === "PASS").length} PASS / ${ev.filter(e => e.status === "WARN").length} WARN / ${ev.filter(e => e.status === "BLOCK").length} BLOCK`]);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "فشل الفحص.");
      setAgentLog(prev => [...prev, "STOP THE LINE → فشل أداة القراءة؛ لم يتم تنفيذ أي كتابة."]);
    } finally { setBusy(false); }
  };

  const addTask = () => {
    if (!task.trim()) return;
    const next = { ...memory, taskLedger: [...memory.taskLedger, task.trim()] };
    setMemory(next); saveMemory(next); setTask("");
  };

  const checkpoint = () => {
    const stamp = new Date().toISOString();
    const label = `${stamp} · level=L${level} · gate=${gate} · repo=${xray?.repo || "none"} · sha=${xray?.sha?.slice(0, 12) || "none"}`;
    const next = { ...memory, checkpoints: [...memory.checkpoints, label] };
    setMemory(next); saveMemory(next);
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="fixed bottom-4 left-4 z-40 rounded-2xl border border-indigo-400/30 bg-slate-950/95 px-4 py-3 text-sm font-bold text-indigo-200 shadow-2xl backdrop-blur">
        🛰️ Mission Control
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/70 p-3 sm:p-6" onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <h2 className="font-bold">GitHub Engineering Mission Control</h2>
                <p className="text-[11px] text-slate-500">X-Ray · Agent · Evidence · RAECS · Persistent Memory</p>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-xl border border-white/10 px-3 py-2 text-sm">إغلاق</button>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 lg:grid-cols-[1.4fr_1fr]">
              <section className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex gap-2">
                    <input value={repoInput} onChange={e => setRepoInput(e.target.value)} placeholder="owner/repo" dir="ltr" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-indigo-400/60" />
                    <button disabled={busy || level < 1} onClick={inspect} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold disabled:opacity-40">{busy ? "يفحص..." : "X-Ray"}</button>
                  </div>
                  {message && <p className="mt-3 text-sm text-amber-300">{message}</p>}
                  <div className="mt-3 flex flex-wrap gap-2"><button disabled={busy || !xray} onClick={verifyCI} className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300 disabled:opacity-40">تحقق من CI</button><span className="self-center text-[11px] text-slate-500">CI: {ciStatus}</span></div>
                  <div className="mt-3 text-xs text-slate-500">الوكيل هنا Read-only: لا commit، لا PR، لا deploy. الكتابة مؤجلة إلى مستوى صلاحيات مستقل.</div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <h3 className="font-semibold">01 · Project X-Ray</h3>
                    {xray ? <div className="mt-3 space-y-2 text-xs text-slate-300">
                      <p><b>Repo:</b> <span dir="ltr">{xray.repo}</span></p>
                      <p><b>Branch:</b> <span dir="ltr">{xray.branch}</span></p>
                      <p><b>Files:</b> {xray.files.length}</p>
                      <p><b>Stack:</b> {xray.stack.join(" · ") || "—"}</p>
                      <p><b>Entry:</b> {xray.entryPoints.join(", ") || "—"}</p>
                      <p><b>CI:</b> {xray.ci.join(", ") || "—"}</p>
                      <p><b>Dependencies:</b> {xray.dependencies.join(", ") || "—"}</p>
                      {xray.riskFlags.map(f => <p key={f} className="text-amber-300">⚠ {f}</p>)}
                    </div> : <p className="mt-3 text-xs text-slate-500">لا يوجد تحليل بعد.</p>}
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <h3 className="font-semibold">02 · Engineering Agent</h3>
                    <div className="mt-3 space-y-2 text-xs text-slate-400">
                      {agentLog.map((x, i) => <div key={i} dir="ltr" className="rounded-lg bg-black/20 px-2 py-1">{x}</div>)}
                      {!agentLog.length && <p>ابدأ بـ X-Ray. كل خطوة تُسجل ولا توجد كتابة.</p>}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold">03 · Verification / Evidence Gate</h3>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${gate === "PASS" ? "bg-emerald-500/15 text-emerald-300" : gate === "BLOCK" ? "bg-red-500/15 text-red-300" : "bg-amber-500/15 text-amber-300"}`}>{gate}</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {evidence.map(e => <div key={e.id} className="rounded-xl bg-black/20 p-3 text-xs">
                      <div className="flex justify-between gap-2"><b>{e.id} · {e.label}</b><span>{e.status}</span></div>
                      <p className="mt-1 text-slate-400">{e.detail}</p>
                    </div>)}
                    {!evidence.length && <p className="text-xs text-slate-500">لا يوجد evidence قبل تشغيل X-Ray.</p>}
                  </div>
                </div>
              </section>

              <aside className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <h3 className="font-semibold">04 · RAECS Governance</h3>
                  <p className="mt-2 text-xs text-slate-400">الوكيل لا يملك السلطة؛ المستوى يحدد ما يمكنه فعله.</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {[0,1,2,3,4,5,6].map(n => <button key={n} onClick={() => setLevel(n)} className={`rounded-xl border px-2 py-2 text-xs ${level === n ? "border-indigo-400 bg-indigo-500/20 text-indigo-200" : "border-white/10 text-slate-400"}`}>L{n} · {["READ","ANALYZE","SAFE WRITE","TEST","COMMIT","PR","DEPLOY"][n]}</button>)}
                  </div>
                  <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
                    {level >= 2 ? "يتطلب المستوى المحدد بوابة صلاحيات وتنفيذ مستقلة؛ هذه الواجهة لا تمنحها تلقائياً." : "الوضع الحالي آمن: القراءة/التحليل فقط."}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <h3 className="font-semibold">05 · Persistent Engineering Memory</h3>
                  <div className="mt-3 flex gap-2">
                    <input value={task} onChange={e => setTask(e.target.value)} placeholder="مهمة جديدة..." className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs" />
                    <button onClick={addTask} className="rounded-xl border border-white/10 px-3 text-xs">إضافة</button>
                  </div>
                  <div className="mt-3 space-y-2 text-xs">
                    <p className="text-slate-400">TASK LEDGER: {memory.taskLedger.length}</p>
                    {memory.taskLedger.slice(-5).map((x,i) => <div key={i} className="rounded-lg bg-black/20 p-2">{x}</div>)}
                    <button onClick={checkpoint} className="mt-2 w-full rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">إنشاء CHECKPOINT</button>
                    <p className="text-slate-500">CHECKPOINTS: {memory.checkpoints.length} · DECISIONS: {memory.decisions.length}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-slate-400">
                  <b className="text-slate-200">Protocol</b>
                  <p className="mt-2" dir="ltr">INSPECT → UNDERSTAND → PLAN → ISOLATE → EXECUTE → TEST → VERIFY → REVIEW → CHECKPOINT</p>
                  <p className="mt-2">لا يُعتبر الادعاء "مكتمل" لمجرد أن التحليل نجح. Build/Test/Review حقيقية ستضاف كأدوات مستقلة قبل السماح بأي release gate.</p>
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
