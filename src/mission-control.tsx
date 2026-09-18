import { useMemo, useState } from "react";

type XRay = {
  repo: string; branch: string; sha: string; files: string[]; truncated: boolean;
  stack: string[]; entryPoints: string[]; ci: string[]; sensitive: string[];
  dependencies: string[]; riskFlags: string[];
};

type Evidence = { id: string; label: string; status: "PASS" | "WARN" | "BLOCK"; detail: string; refs?: string[]; };
type DiffFile = { filename: string; status?: string | null; additions?: number | null; deletions?: number | null; changes?: number | null; };
type Diff = { base: string; head: string; ahead_by?: number; behind_by?: number; total_commits?: number; files: DiffFile[]; };
type ReviewFinding = { id: string; severity: "PASS" | "WARN" | "BLOCK"; title: string; detail: string; refs: string[]; };
type GraphNode = { id: string; kind: "CLAIM" | "SHA" | "FILE" | "CI" | "REVIEW" | "CHECKPOINT"; label: string; };
type GraphEdge = { from: string; to: string; relation: string; };

type Memory = { taskLedger: string[]; decisions: string[]; checkpoints: string[]; };

const API = "https://api.github.com";
const VERSION = "2022-11-28";
const MEMORY_KEY = "github-mission-control-memory-v1";

function token() { try { return localStorage.getItem("github-viewer-token") || ""; } catch { return ""; } }
async function gh<T>(path: string): Promise<T> {
  const t = token();
  const res = await fetch(API + path, { headers: {
    Accept: "application/vnd.github+json", "X-GitHub-Api-Version": VERSION,
    ...(t ? { Authorization: `Bearer ${t}` } : {}),
  }});
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json() as Promise<T>;
}
function loadMemory(): Memory {
  try { const raw = localStorage.getItem(MEMORY_KEY); if (raw) return JSON.parse(raw); } catch {}
  return { taskLedger: [], decisions: [], checkpoints: [] };
}
function saveMemory(m: Memory) { try { localStorage.setItem(MEMORY_KEY, JSON.stringify(m)); } catch {} }

function detectStack(files: string[]) {
  const f = new Set(files), out: string[] = [];
  if (f.has("package.json")) out.push("Node.js / JavaScript");
  if (f.has("tsconfig.json") || files.some(x => x.endsWith(".ts") || x.endsWith(".tsx"))) out.push("TypeScript");
  if (f.has("vite.config.ts") || f.has("vite.config.js")) out.push("Vite");
  if (f.has("next.config.js") || f.has("next.config.mjs") || f.has("next.config.ts")) out.push("Next.js");
  if (f.has("requirements.txt") || f.has("pyproject.toml")) out.push("Python");
  if (f.has("Dockerfile")) out.push("Docker");
  if (files.some(x => x.startsWith(".github/workflows/"))) out.push("GitHub Actions");
  if (files.some(x => x.startsWith("android/"))) out.push("Android");
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
    { id: "XRAY-001", label: "الوصول إلى المستودع", status: x.sha ? "PASS" : "BLOCK", detail: x.sha ? `HEAD ${x.sha.slice(0, 12)}` : "لا يوجد SHA موثوق.", refs: ["SHA-" + x.sha.slice(0, 12)] },
    { id: "XRAY-002", label: "فحص شجرة الملفات", status: x.files.length ? (x.truncated ? "WARN" : "PASS") : "BLOCK", detail: `${x.files.length} مساراً مكتشفاً${x.truncated ? " مع truncation" : ""}.` },
    { id: "XRAY-003", label: "اكتشاف التقنية", status: x.stack.length ? "PASS" : "WARN", detail: x.stack.join(" · ") || "لم يتم اكتشاف stack واضح." },
    { id: "SEC-001", label: "مؤشرات ملفات حساسة", status: x.sensitive.length ? "WARN" : "PASS", detail: x.sensitive.length ? `${x.sensitive.length} مساراً يحتاج مراجعة.` : "لا توجد أسماء ملفات حساسة معروفة في الشجرة." },
    { id: "CI-001", label: "CI/CD", status: x.ci.length ? "PASS" : "WARN", detail: x.ci.length ? `${x.ci.length} workflow(s).` : "لا توجد workflows مكتشفة." },
    { id: "GATE-001", label: "بوابة الادعاء", status: x.truncated || x.sensitive.length ? "WARN" : "PASS", detail: x.truncated ? "لا يسمح هذا الفحص بادعاء اكتمال التحليل." : "الأدلة الحالية تثبت تحليلاً أولياً فقط؛ ليست إثباتاً لبناء أو اختبار." },
  ];
}

function runAdversarialReview(base: string, head: string, diff: Diff | null, x: XRay | null, evidence: Evidence[]): ReviewFinding[] {
  if (!diff || !x) return [{ id: "ADV-000", severity: "WARN", title: "لا توجد مقارنة", detail: "شغّل X-Ray ثم Commit/Diff Inspection قبل المراجعة العدائية.", refs: [] }];
  const files = diff.files.map(f => f.filename);
  const findings: ReviewFinding[] = [];
  const allowed = new Set(["src/mission-control.tsx", "src/main.tsx", "public/sw.js", ".github/workflows/ci.yml", "ENGINEERING_MISSION_CONTROL.md", "RAECS_MISSION_POLICY.md"]);
  const unexpected = files.filter(f => !allowed.has(f));
  if (unexpected.length) findings.push({ id: "ADV-001", severity: "BLOCK", title: "Scope creep / unexpected files", detail: `ظهرت ${unexpected.length} ملفات خارج نطاق التغيير المتوقع.`, refs: unexpected });
  else findings.push({ id: "ADV-001", severity: "PASS", title: "Scope boundary", detail: "كل الملفات الحالية ضمن نطاق Mission Control المصرّح به.", refs: files });
  const sensitive = files.filter(f => /(^|\/)(\.env|\.env\.|.*\.pem$|.*\.key$|credentials?\.|secrets?\.)/i.test(f));
  findings.push(sensitive.length ? { id: "ADV-002", severity: "BLOCK", title: "Sensitive-path change", detail: "تغيير مسار حساس يحتاج إيقافاً ومراجعة بشرية.", refs: sensitive } : { id: "ADV-002", severity: "PASS", title: "Sensitive-path check", detail: "لا توجد تغييرات على مسارات حساسة معروفة.", refs: [] });
  const workflowChanged = files.some(f => f.startsWith(".github/workflows/"));
  findings.push(workflowChanged ? { id: "ADV-003", severity: "WARN", title: "CI policy changed", detail: "تم تغيير workflow؛ يلزم فحص CI الفعلي قبل أي release claim.", refs: files.filter(f => f.startsWith(".github/workflows/")) } : { id: "ADV-003", severity: "PASS", title: "CI policy unchanged", detail: "لم تتغير workflows في المقارنة.", refs: [] });
  const swChanged = files.includes("public/sw.js");
  findings.push(swChanged ? { id: "ADV-004", severity: "WARN", title: "Service worker changed", detail: "تغيير SW قد يؤثر على التخزين/الخصوصية؛ يجب التحقق من عدم تخزين بيانات GitHub الخاصة.", refs: ["public/sw.js"] } : { id: "ADV-004", severity: "PASS", title: "Service worker unchanged", detail: "لا تغيير في service worker.", refs: [] });
  const writes = files.some(f => /(^|\/)(deploy|release|publish|scripts\/.*(write|push|deploy))/i.test(f));
  findings.push(writes ? { id: "ADV-005", severity: "BLOCK", title: "Potential hidden write path", detail: "ظهر مسار يوحي بتنفيذ كتابة/نشر؛ Read-only boundary لا تسمح بذلك.", refs: files } : { id: "ADV-005", severity: "PASS", title: "Read-only boundary", detail: "المقارنة لا تكشف مسار نشر/كتابة مخفياً.", refs: [] });
  const total = files.reduce((n, f) => n + (f.changes || 0), 0);
  findings.push(total > 800 ? { id: "ADV-006", severity: "WARN", title: "Large change surface", detail: `إجمالي التغييرات ${total} سطراً؛ المراجعة اليدوية مطلوبة.`, refs: files } : { id: "ADV-006", severity: "PASS", title: "Change size", detail: `إجمالي التغييرات ${total} سطراً ضمن حد المراجعة الأولي.`, refs: [] });
  const ci = evidence.find(e => e.id === "CI-002");
  findings.push(!ci || ci.status !== "PASS" ? { id: "ADV-007", severity: "BLOCK", title: "No current CI proof", detail: "لا توجد أدلة CI ناجحة مرتبطة بـ HEAD الحالي؛ لا يجوز تحويل WARN إلى PASS.", refs: ci ? ["CI-002"] : [] } : { id: "ADV-007", severity: "PASS", title: "Current CI evidence", detail: "يوجد دليل CI ناجح مرتبط بالـ HEAD الحالي.", refs: ["CI-002"] });
  findings.push({ id: "ADV-008", severity: "PASS", title: "Base/head binding", detail: `المقارنة مربوطة صراحةً بـ ${base.slice(0, 12)} → ${head.slice(0, 12)}.`, refs: ["SHA-" + base.slice(0, 12), "SHA-" + head.slice(0, 12)] });
  return findings;
}

function buildGraph(x: XRay | null, diff: Diff | null, evidence: Evidence[], review: ReviewFinding[], checkpoint?: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [], edges: GraphEdge[] = [];
  if (!x) return { nodes, edges };
  const shaId = "SHA-" + x.sha.slice(0, 12);
  nodes.push({ id: "CLAIM-XRAY", kind: "CLAIM", label: "X-Ray: repository structure analyzed" });
  nodes.push({ id: shaId, kind: "SHA", label: x.sha.slice(0, 12) });
  edges.push({ from: "CLAIM-XRAY", to: shaId, relation: "bound-to" });
  x.files.slice(0, 40).forEach(f => { const id = "FILE-" + f; nodes.push({ id, kind: "FILE", label: f }); edges.push({ from: shaId, to: id, relation: "contains" }); });
  evidence.forEach(e => { const id = "EV-" + e.id; nodes.push({ id, kind: e.status === "PASS" ? "CI" : "REVIEW", label: `${e.id}: ${e.status}` }); edges.push({ from: id, to: shaId, relation: "supports" }); (e.refs || []).forEach(r => edges.push({ from: id, to: r.startsWith("FILE-") ? r : shaId, relation: "references" })); });
  review.forEach(r => { const id = "REV-" + r.id; nodes.push({ id, kind: "REVIEW", label: `${r.id}: ${r.severity}` }); edges.push({ from: id, to: shaId, relation: "reviews" }); r.refs.forEach(ref => edges.push({ from: id, to: ref.startsWith("FILE-") ? ref : shaId, relation: "references" })); });
  if (diff) { const id = "DIFF-" + diff.head.slice(0, 12); nodes.push({ id, kind: "SHA", label: `DIFF ${diff.base.slice(0, 7)}...${diff.head.slice(0, 7)}` }); edges.push({ from: "CLAIM-XRAY", to: id, relation: "compared-with" }); }
  if (checkpoint) { const id = "CP-" + checkpoint.slice(0, 16).replace(/[^a-z0-9]/gi, ""); nodes.push({ id, kind: "CHECKPOINT", label: "Checkpoint" }); edges.push({ from: id, to: shaId, relation: "records" }); }
  return { nodes, edges };
}

export default function MissionControl() {
  const [open, setOpen] = useState(false), [repoInput, setRepoInput] = useState("");
  const [xray, setXray] = useState<XRay | null>(null), [evidence, setEvidence] = useState<Evidence[]>([]);
  const [busy, setBusy] = useState(false), [agentLog, setAgentLog] = useState<string[]>([]);
  const [level, setLevel] = useState(1), [memory, setMemory] = useState<Memory>(loadMemory());
  const [task, setTask] = useState(""), [message, setMessage] = useState(""), [ciStatus, setCiStatus] = useState("NOT_CHECKED");
  const [diff, setDiff] = useState<Diff | null>(null), [review, setReview] = useState<ReviewFinding[]>([]);
  const [showGraph, setShowGraph] = useState(false);

  const gate = useMemo(() => {
    if (!evidence.length) return "NOT_RUN";
    if (evidence.some(e => e.status === "BLOCK")) return "BLOCK";
    if (evidence.some(e => e.status === "WARN")) return "REVIEW";
    return "PASS";
  }, [evidence]);
  const graph = useMemo(() => buildGraph(xray, diff, evidence, review, memory.checkpoints.at(-1)), [xray, diff, evidence, review, memory.checkpoints]);

  const inspect = async () => {
    const value = repoInput.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
    const match = value.match(/^([^/]+)\/([^/]+)$/);
    if (!match) { setMessage("أدخل owner/repo مثل gophisb/github-viewer."); return; }
    setBusy(true); setMessage(""); setAgentLog([]); setDiff(null); setReview([]);
    try {
      setAgentLog(["L1 ANALYZE → GET repository metadata", "L1 ANALYZE → GET recursive Git tree"]);
      const meta = await gh<any>(`/repos/${match[1]}/${match[2]}`);
      const tree = await gh<any>(`/repos/${match[1]}/git/trees/${encodeURIComponent(meta.default_branch)}?recursive=1`);
      const result = analyze(value, meta.default_branch, tree), ev = buildEvidence(result);
      setXray(result); setEvidence(ev); setCiStatus("NOT_CHECKED"); try { localStorage.setItem("github-mission-control-runtime-target-v1", JSON.stringify({ repo: result.repo, branch: result.branch, sha: result.sha, gate: "BLOCK" })); } catch {}
      setAgentLog(prev => [...prev, `VERIFY → ${ev.filter(e => e.status === "PASS").length} PASS / ${ev.filter(e => e.status === "WARN").length} WARN / ${ev.filter(e => e.status === "BLOCK").length} BLOCK`]);
    } catch (e) { setMessage(e instanceof Error ? e.message : "فشل الفحص."); setAgentLog(prev => [...prev, "STOP THE LINE → فشل أداة القراءة؛ لم يتم تنفيذ أي كتابة."]); }
    finally { setBusy(false); }
  };

  const inspectDiff = async () => {
    if (!xray?.repo || !xray.sha) { setMessage("شغّل X-Ray أولاً."); return; }
    setBusy(true); setMessage("");
    try {
      const base = "main";
      const data = await gh<any>(`/repos/${xray.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(xray.sha)}`);
      const d: Diff = { base: data.base_commit?.sha || base, head: data.head_commit?.sha || xray.sha, ahead_by: data.ahead_by, behind_by: data.behind_by, total_commits: data.total_commits, files: Array.isArray(data.files) ? data.files : [] };
      setDiff(d);
      setAgentLog(prev => [...prev, `INSPECT → DIFF main...${xray.sha.slice(0, 12)} · ${d.files.length} files`]);
      setReview(runAdversarialReview(d.base, d.head, d, xray, evidence));
    } catch (e) { setMessage(e instanceof Error ? e.message : "فشل فحص diff."); }
    finally { setBusy(false); }
  };

  const verifyCI = async () => {
    if (!xray?.sha) { setMessage("شغّل X-Ray أولاً."); return; }
    setBusy(true); setMessage("");
    try {
      const data = await gh<any>(`/repos/${xray.repo}/actions/runs?head_sha=${encodeURIComponent(xray.sha)}&per_page=20`);
      const runs = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
      let ev: Evidence;
      if (!runs.length) { setCiStatus("NO_RUN"); ev = { id: "CI-002", label: "GitHub Actions evidence", status: "WARN", detail: "لا توجد workflow run مرتبطة بهذا SHA؛ لا يمكن إثبات build/test.", refs: ["SHA-" + xray.sha.slice(0, 12)] }; }
      else {
        const completed = runs.find((r: any) => r.status === "completed"), passed = completed?.conclusion === "success";
        setCiStatus(completed?.conclusion || completed?.status || "UNKNOWN");
        ev = completed ? { id: "CI-002", label: "GitHub Actions evidence", status: passed ? "PASS" : "BLOCK", detail: `${completed.name || "CI"} · ${completed.conclusion} · run #${completed.run_number ?? "?"} · SHA ${xray.sha.slice(0, 12)}`, refs: ["SHA-" + xray.sha.slice(0, 12)] } : { id: "CI-002", label: "GitHub Actions evidence", status: "WARN", detail: "Workflow موجودة لكن لم تكتمل بعد.", refs: ["SHA-" + xray.sha.slice(0, 12)] };
      }
      const next = [...evidence.filter(e => e.id !== "CI-002"), ev]; setEvidence(next); try { localStorage.setItem("github-mission-control-runtime-target-v1", JSON.stringify({ repo: xray.repo, branch: xray.branch, sha: xray.sha, gate: ev.status === "PASS" && !next.some(e => e.status === "BLOCK") ? "PASS" : "BLOCK" })); } catch {}
      setAgentLog(prev => [...prev, `VERIFY → CI ${ev.status} · ${ev.detail}`]);
      if (diff) setReview(runAdversarialReview(diff.base, diff.head, diff, xray, next));
    } catch (e) { setCiStatus("ERROR"); setMessage(e instanceof Error ? e.message : "فشل التحقق من CI."); }
    finally { setBusy(false); }
  };

  const addTask = () => { if (!task.trim()) return; const next = { ...memory, taskLedger: [...memory.taskLedger, task.trim()] }; setMemory(next); saveMemory(next); setTask(""); };
  const checkpoint = () => {
    const stamp = new Date().toISOString(), label = `${stamp} · level=L${level} · gate=${gate} · repo=${xray?.repo || "none"} · sha=${xray?.sha?.slice(0, 12) || "none"} · review=${review.length}`;
    const next = { ...memory, checkpoints: [...memory.checkpoints, label] }; setMemory(next); saveMemory(next);
  };

  return (<>
    <button onClick={() => setOpen(true)} className="fixed bottom-4 left-4 z-40 rounded-2xl border border-indigo-400/30 bg-slate-950/95 px-4 py-3 text-sm font-bold text-indigo-200 shadow-2xl backdrop-blur">🛰️ Mission Control</button>
    {open && <div className="fixed inset-0 z-50 bg-black/70 p-3 sm:p-6" onClick={() => setOpen(false)}>
      <div onClick={e => e.stopPropagation()} className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><div><h2 className="font-bold">GitHub Engineering Mission Control</h2><p className="text-[11px] text-slate-500">X-Ray · Agent · Evidence Graph · Diff · Adversarial Review · RAECS</p></div><button onClick={() => setOpen(false)} className="rounded-xl border border-white/10 px-3 py-2 text-sm">إغلاق</button></div>
        <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 lg:grid-cols-[1.4fr_1fr]">
          <section className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex gap-2"><input value={repoInput} onChange={e => setRepoInput(e.target.value)} placeholder="owner/repo" dir="ltr" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-indigo-400/60" /><button disabled={busy || level < 1} onClick={inspect} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold disabled:opacity-40">{busy ? "يفحص..." : "X-Ray"}</button></div>
              {message && <p className="mt-3 text-sm text-amber-300">{message}</p>}
              <div className="mt-3 flex flex-wrap gap-2"><button disabled={busy || !xray} onClick={verifyCI} className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300 disabled:opacity-40">تحقق من CI</button><button disabled={busy || !xray} onClick={inspectDiff} className="rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-xs text-sky-300 disabled:opacity-40">Commit / Diff Inspection</button><button disabled={!xray} onClick={() => setReview(runAdversarialReview(diff?.base || "main", diff?.head || xray?.sha || "", diff, xray, evidence))} className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300 disabled:opacity-40">Adversarial Review</button><button disabled={!xray} onClick={() => setShowGraph(v => !v)} className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-xs text-violet-300 disabled:opacity-40">{showGraph ? "إخفاء Evidence Graph" : "Evidence Graph"}</button><span className="self-center text-[11px] text-slate-500">CI: {ciStatus}</span></div>
              <div className="mt-3 text-xs text-slate-500">الوكيل الحالي Read-only: لا commit، لا PR، لا deploy. الأدوات المعروضة للقراءة والتحقق فقط.</div>
            </div>

            {showGraph && <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4"><div className="flex items-center justify-between"><h3 className="font-semibold">Evidence Graph</h3><span className="text-[11px] text-slate-400">{graph.nodes.length} nodes · {graph.edges.length} edges</span></div><div className="mt-3 max-h-72 space-y-1 overflow-auto text-[11px]">{graph.nodes.map(n => <div key={n.id} className="rounded-lg bg-black/20 px-2 py-1"><b>{n.kind}</b> · {n.label}</div>)}<p className="mt-2 text-slate-500">العلاقات: {graph.edges.slice(0, 12).map(e => `${e.from} → ${e.to} [${e.relation}]`).join(" · ")}</p></div></div>}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><h3 className="font-semibold">01 · Project X-Ray</h3>{xray ? <div className="mt-3 space-y-2 text-xs text-slate-300"><p><b>Repo:</b> <span dir="ltr">{xray.repo}</span></p><p><b>Branch:</b> <span dir="ltr">{xray.branch}</span></p><p><b>HEAD:</b> <span dir="ltr">{xray.sha.slice(0,12)}</span></p><p><b>Files:</b> {xray.files.length}</p><p><b>Stack:</b> {xray.stack.join(" · ") || "—"}</p><p><b>Entry:</b> {xray.entryPoints.join(", ") || "—"}</p><p><b>CI:</b> {xray.ci.join(", ") || "—"}</p><p><b>Dependencies:</b> {xray.dependencies.join(", ") || "—"}</p>{xray.riskFlags.map(f => <p key={f} className="text-amber-300">⚠ {f}</p>)}</div> : <p className="mt-3 text-xs text-slate-500">لا يوجد تحليل بعد.</p>}</div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><h3 className="font-semibold">02 · Engineering Agent</h3><div className="mt-3 space-y-2 text-xs text-slate-400">{agentLog.map((x,i) => <div key={i} dir="ltr" className="rounded-lg bg-black/20 px-2 py-1">{x}</div>)}{!agentLog.length && <p>ابدأ بـ X-Ray. كل خطوة تُسجل ولا توجد كتابة.</p>}</div></div>
            </div>

            {diff && <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4"><div className="flex items-center justify-between"><h3 className="font-semibold">Commit / Diff Inspection</h3><span className="text-xs text-sky-300">{diff.ahead_by ?? 0} ahead · {diff.behind_by ?? 0} behind</span></div><p className="mt-2 text-[11px] text-slate-400" dir="ltr">{diff.base.slice(0,12)} → {diff.head.slice(0,12)} · {diff.total_commits ?? 0} commits · {diff.files.length} files</p><div className="mt-3 max-h-64 space-y-1 overflow-auto text-xs">{diff.files.map(f => <div key={f.filename} className="flex justify-between gap-3 rounded-lg bg-black/20 p-2"><span dir="ltr" className="truncate">{f.filename}</span><span className="shrink-0 text-slate-500">+{f.additions ?? 0} -{f.deletions ?? 0}</span></div>)}</div></div>}

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">03 · Verification / Evidence Gate</h3><span className={`rounded-full px-3 py-1 text-xs font-bold ${gate === "PASS" ? "bg-emerald-500/15 text-emerald-300" : gate === "BLOCK" ? "bg-red-500/15 text-red-300" : "bg-amber-500/15 text-amber-300"}`}>{gate}</span></div><div className="mt-3 space-y-2">{evidence.map(e => <div key={e.id} className="rounded-xl bg-black/20 p-3 text-xs"><div className="flex justify-between gap-2"><b>{e.id} · {e.label}</b><span>{e.status}</span></div><p className="mt-1 text-slate-400">{e.detail}</p></div>)}{!evidence.length && <p className="text-xs text-slate-500">لا يوجد evidence قبل تشغيل X-Ray.</p>}</div></div>

            {review.length > 0 && <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4"><div className="flex items-center justify-between"><h3 className="font-semibold">06 · Adversarial Reviewer</h3><span className="text-xs text-slate-400">{review.filter(r => r.severity==="BLOCK").length} BLOCK · {review.filter(r => r.severity==="WARN").length} WARN</span></div><div className="mt-3 space-y-2">{review.map(r => <div key={r.id} className="rounded-xl bg-black/20 p-3 text-xs"><div className="flex justify-between gap-2"><b>{r.id} · {r.title}</b><span className={r.severity==="BLOCK" ? "text-red-300" : r.severity==="WARN" ? "text-amber-300" : "text-emerald-300"}>{r.severity}</span></div><p className="mt-1 text-slate-400">{r.detail}</p></div>)}</div></div>}
          </section>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><h3 className="font-semibold">04 · RAECS Governance</h3><p className="mt-2 text-xs text-slate-400">المستوى يصف نطاق السلطة المقترح ولا يمنح صلاحيات GitHub.</p><div className="mt-3 grid grid-cols-2 gap-2">{[0,1,2,3,4,5,6].map(n => <button key={n} onClick={() => setLevel(n)} className={`rounded-xl border px-2 py-2 text-xs ${level===n ? "border-indigo-400 bg-indigo-500/20 text-indigo-200" : "border-white/10 text-slate-400"}`}>L{n} · {["READ","ANALYZE","SAFE WRITE","TEST","COMMIT","PR","DEPLOY"][n]}</button>)}</div><div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">{level >= 2 ? "يتطلب المستوى المحدد بوابة صلاحيات وتنفيذ مستقلة؛ هذه الواجهة لا تمنحها." : "الوضع الحالي آمن: القراءة/التحليل فقط."}</div></div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><h3 className="font-semibold">05 · Persistent Engineering Memory</h3><div className="mt-3 flex gap-2"><input value={task} onChange={e=>setTask(e.target.value)} placeholder="مهمة جديدة..." className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs" /><button onClick={addTask} className="rounded-xl border border-white/10 px-3 text-xs">إضافة</button></div><div className="mt-3 space-y-2 text-xs"><p className="text-slate-400">TASK LEDGER: {memory.taskLedger.length}</p>{memory.taskLedger.slice(-5).map((x,i)=><div key={i} className="rounded-lg bg-black/20 p-2">{x}</div>)}<button onClick={checkpoint} className="mt-2 w-full rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">إنشاء CHECKPOINT</button><p className="text-slate-500">CHECKPOINTS: {memory.checkpoints.length} · DECISIONS: {memory.decisions.length}</p></div></div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-slate-400"><b className="text-slate-200">Protocol</b><p className="mt-2" dir="ltr">INSPECT → UNDERSTAND → PLAN → ISOLATE → EXECUTE → TEST → VERIFY → REVIEW → CHECKPOINT</p><p className="mt-2">Evidence Graph يربط الادعاء بالـ SHA والملفات ونتيجة CI والمراجعة والـ checkpoint. لا توجد صلاحية كتابة في هذه المرحلة.</p></div>
          </aside>
        </div>
      </div>
    </div>}
  </>);
}
