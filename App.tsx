import { useEffect, useMemo, useState } from "react";
import AIEngineeringAgent from "./AIEngineeringAgent";

declare global { interface Window { JSZip: any } }

type GitHubUser = {
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
  bio: string | null;
  location: string | null;
  company: string | null;
  public_repos: number;
  followers: number;
  following: number;
  created_at: string;
};

type Repo = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  private: boolean;
  fork: boolean;
  updated_at: string;
  default_branch: string;
  topics?: string[];
  size: number;
};

type RepoItem = {
  name: string;
  path: string;
  sha: string;
  size?: number;
  type: "file" | "dir";
  download_url?: string | null;
  html_url?: string;
};

type FileResponse = RepoItem & {
  type: "file";
  content?: string;
  encoding?: string;
  size: number;
};

type Activity = {
  id: string;
  type: string;
  repo?: { name: string };
  created_at: string;
};

const CACHE_KEY = "github-viewer-dashboard";

const LANG_COLORS: Record<string, string> = {
  JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572A5", "C++": "#f34b7d",
  C: "#555555", "C#": "#178600", Java: "#b07219", Go: "#00ADD8", Rust: "#dea584",
  Ruby: "#701516", PHP: "#4F5D95", Swift: "#F05138", Kotlin: "#A97BFF", Dart: "#00B4AB",
  Shell: "#89e051", HTML: "#e34c26", CSS: "#563d7c",
};

function csrfToken() {
  const m=document.cookie.match(/(?:^|; )github_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}
async function githubFetch<T>(path: string, _legacyToken = "", init: RequestInit = {}): Promise<T> {
  const headers:any = { ...(init.headers||{}), Accept:"application/vnd.github+json", "X-GitHub-Api-Version":"2022-11-28" };
  const method=(init.method||"GET").toUpperCase();
  if(!["GET","HEAD"].includes(method)) {
    const csrf=csrfToken();
    if(csrf) headers["X-CSRF-Token"]=csrf;
  }
  const response=await fetch("/api/github/proxy?path="+encodeURIComponent(path),{...init,headers,credentials:"include"});
  if(response.status===401) throw new Error("جلسة GitHub غير موجودة أو منتهية. أعد تسجيل الدخول.");
  if(response.status===403) throw new Error("رفض GitHub الطلب أو فشل فحص CSRF/الصلاحيات.");
  if(response.status===404) throw new Error("لم يتم العثور على المورد أو لا تملك الجلسة الصلاحية للوصول إليه.");
  if(!response.ok){const body=await response.text();throw new Error(body||`GitHub API: ${response.status}`);}
  return response.json() as Promise<T>;
}

async function fetchAllRepos(_legacyToken = "") {
  const all: Repo[] = [];
  for(let page=1;page<=10;page++){
    const batch=await githubFetch<Repo[]>(`/user/repos?per_page=100&page=${page}&sort=updated&direction=desc&visibility=all&affiliation=owner,collaborator,organization_member`);
    all.push(...batch);
    if(batch.length<100) break;
  }
  return all;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("ar-EG", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex h-5 w-5 items-center justify-center">{children}</span>;
}

function StatCard({ label, value, icon }: { label: string; value: number | string; icon: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between">
        <span className="text-2xl font-bold text-white">{value}</span>
        <span className="text-xl">{icon}</span>
      </div>
      <div className="mt-1 text-xs text-slate-400">{label}</div>
    </div>
  );
}

function RepoCard({ repo, onOpen }: { repo: Repo; onOpen: (repo: Repo) => void }) {
  return (
    <button
      onClick={() => onOpen(repo)}
      className="group flex h-full w-full flex-col rounded-2xl border border-white/10 bg-white/5 p-4 text-right transition hover:border-indigo-400/50 hover:bg-white/10"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-slate-100 group-hover:text-indigo-300" dir="ltr">
            {repo.name}
          </h3>
          <p className="mt-1 text-[11px] text-slate-500" dir="ltr">{repo.full_name}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] ${repo.private ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"}`}>
          {repo.private ? "خاص" : "عام"}
        </span>
      </div>
      <p className="mt-3 line-clamp-2 text-sm text-slate-400">
        {repo.description || "لا يوجد وصف"}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-3 pt-4 text-xs text-slate-400">
        {repo.language && (
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: LANG_COLORS[repo.language] || "#8b949e" }} />
            {repo.language}
          </span>
        )}
        <span>★ {repo.stargazers_count}</span>
        <span>⑂ {repo.forks_count}</span>
        <span>{formatDate(repo.updated_at)}</span>
      </div>
    </button>
  );
}


function ZipUploader({ repos, token: _token, onDone }: { repos: Repo[]; token?: string; onDone: () => void }) {
  const [repoName, setRepoName] = useState(repos[0]?.full_name || "");
  const [folder, setFolder] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState("");
  useEffect(() => { if (!repoName && repos[0]) setRepoName(repos[0].full_name); }, [repos, repoName]);

  const upload = async () => {
    if (!zipFile || !repoName || running) return;
    setRunning(true); setProgress(0); setResult(""); setStatus("قراءة ملف ZIP...");
    try {
      if (!window.JSZip) throw new Error("محرك ZIP لم يُحمّل بعد. أعد تحميل الصفحة.");
      const zip = await window.JSZip.loadAsync(zipFile);
      const entries = Object.values(zip.files).filter((entry: any) => !entry.dir) as any[];
      if (!entries.length) throw new Error("ملف ZIP لا يحتوي على ملفات.");
      const safeEntries = entries.map((entry: any) => {
        const raw = String(entry.name).replace(/\\/g, "/");
        const clean = raw.replace(/^\/+/, "");
        if (!clean || clean.split("/").some((part: string) => part === "..")) throw new Error(`مسار غير آمن داخل ZIP: ${raw}`);
        return { entry, path: clean };
      });
      const repo = repos.find((r) => r.full_name === repoName);
      if (!repo) throw new Error("المستودع المحدد غير موجود.");

      // ZIP uploads are always isolated: never move the user's default branch directly.
      const branchName = `ai-zip/${Date.now()}`;
      const ref = await githubFetch<any>(`/repos/${repo.full_name}/git/ref/heads/${encodeURIComponent(repo.default_branch)}`);
      const parentSha = ref.object.sha;
      const parentCommit = await githubFetch<any>(`/repos/${repo.full_name}/git/commits/${parentSha}`);
      setStatus("إنشاء فرع معزول...");

      await githubFetch<any>(`/repos/${repo.full_name}/git/refs`, undefined as any, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: parentSha })
      });

      const treeElements: any[] = [];
      for (let i = 0; i < safeEntries.length; i++) {
        const { entry, path } = safeEntries[i];
        const cleanFolder = folder.trim().replace(/^\/+|\/+$/g, "");
        const targetPath = [cleanFolder, path].filter(Boolean).join("/");
        setCurrent(path); setStatus(`رفع ${i + 1} من ${safeEntries.length}`);
        const base64 = await entry.async("base64");
        const blob = await githubFetch<any>(`/repos/${repo.full_name}/git/blobs`, undefined as any, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: base64, encoding: "base64" })
        });
        treeElements.push({ path: targetPath, mode: "100644", type: "blob", sha: blob.sha });
        setProgress(Math.round(((i + 1) / safeEntries.length) * 75));
      }

      setStatus("إنشاء commit على الفرع المعزول...");
      const tree = await githubFetch<any>(`/repos/${repo.full_name}/git/trees`, undefined as any, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_tree: parentCommit.tree.sha, tree: treeElements })
      });
      const commit = await githubFetch<any>(`/repos/${repo.full_name}/git/commits`, undefined as any, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `Upload ZIP: ${zipFile.name}`, tree: tree.sha, parents: [parentSha] })
      });
      setStatus("تحديث الفرع...");
      await githubFetch<any>(`/repos/${repo.full_name}/git/refs/heads/${encodeURIComponent(branchName)}`, undefined as any, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha: commit.sha, force: false })
      });
      setProgress(85);

      setStatus("فتح Draft PR...");
      const pr = await githubFetch<any>(`/repos/${repo.full_name}/pulls`, undefined as any, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Upload ZIP: ${zipFile.name}`,
          head: branchName,
          base: repo.default_branch,
          body: `ZIP upload created safely on isolated branch \`\${branchName}\`. Default branch was not modified directly.`,
          draft: true
        })
      });

      setProgress(100);
      setStatus("اكتمل الرفع بأمان");
      setResult(`تم رفع ${safeEntries.length} ملفًا إلى فرع معزول وفتح Draft PR #${pr.number} في ${repo.full_name}. الفرع الأساسي لم يُعدّل مباشرة.`);
      onDone();
    } catch (e) {
      setResult(e instanceof Error ? e.message : "فشل رفع ZIP.");
      setStatus("توقف الرفع");
    } finally { setRunning(false); }
  };

  return (
    <section id="zip-upload" className="mt-8 rounded-3xl border-2 border-indigo-400/40 bg-indigo-500/10 p-5 shadow-lg shadow-indigo-950/30 sm:p-6">
      <div className="flex items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-500/20 text-xl">📦</div><div><h2 className="text-xl font-bold">رفع مشروع ZIP إلى GitHub</h2><p className="mt-1 text-sm text-slate-400">يفك ZIP داخل المتصفح ثم يرفعه إلى فرع معزول ويفتح Draft PR؛ لا يتم تعديل الفرع الأساسي مباشرة.</p></div></div>
      <div className="mt-5 mb-4 rounded-xl border border-indigo-300/20 bg-slate-950/50 px-4 py-3 text-sm text-indigo-100">اختر المستودع ← اختر ملف ZIP ← اضغط «رفع ZIP إلى GitHub». سيُنشأ فرع معزول وDraft PR ولن نلمس الفرع الأساسي مباشرة.</div><div className="mt-5 grid gap-3 md:grid-cols-3">
        <select value={repoName} onChange={(e) => setRepoName(e.target.value)} disabled={running} className="rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm" dir="ltr">{repos.map((r) => <option key={r.id} value={r.full_name}>{r.full_name}</option>)}</select>
        <input value={folder} onChange={(e) => setFolder(e.target.value)} disabled={running} placeholder="مجلد داخل المستودع (اختياري)" className="rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none focus:border-indigo-400/60" dir="ltr" />
        <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/5 px-4 py-3 text-sm text-slate-300 hover:bg-white/10"><input type="file" accept=".zip,application/zip" disabled={running} onChange={(e) => setZipFile(e.target.files?.[0] || null)} className="hidden" />{zipFile ? `📄 ${zipFile.name}` : "اختيار ملف ZIP"}</label>
      </div>
      <button onClick={upload} disabled={!zipFile || !repoName || running} className="mt-3 w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-5 py-3 font-semibold text-white disabled:opacity-40">{running ? "جارٍ الرفع..." : "رفع ZIP إلى GitHub"}</button>
      {(running || status) && <div className="mt-4"><div className="mb-2 flex justify-between text-xs text-slate-400"><span>{status}</span><span>{progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} /></div>{current && <p className="mt-2 truncate text-xs text-slate-500" dir="ltr">{current}</p>}</div>}
      {result && <div className={result.startsWith("تم رفع") ? "mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300" : "mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"}>{result}</div>}
      <p className="mt-3 text-xs text-slate-500">يتطلب الحساب صلاحية الكتابة على المستودع. ملف ZIP لا يُرسل إلى خادم وسيط، والرفع يمر دائمًا عبر فرع معزول وDraft PR.</p>
    </section>
  );
}


function ConnectionScreen({
  onConnect,
  onPublic,
  error,
}: {
  onConnect: () => void;
  onPublic: (login: string) => void;
  error: string;
}) {
  const [publicUser, setPublicUser] = useState("");

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <div className="text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-600 shadow-lg shadow-indigo-500/30">
          <svg viewBox="0 0 24 24" className="h-9 w-9 fill-current text-white">
            <path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.21 3.44 9.62 8.21 11.18.6.11.82-.25.82-.56 0-.27-.01-1.16-.02-2.1-3.34.71-4.04-1.41-4.04-1.41-.55-1.35-1.34-1.71-1.34-1.71-1.09-.72.08-.71.08-.71 1.21.08 1.84 1.21 1.84 1.21 1.07 1.8 2.81 1.28 3.5.98.11-.76.42-1.28.76-1.57-2.67-.3-5.47-1.31-5.47-5.83 0-1.29.47-2.34 1.24-3.17-.13-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.21a11.6 11.6 0 0 1 6 0c2.29-1.53 3.3-1.21 3.3-1.21.66 1.65.25 2.87.12 3.17.77.83 1.23 1.88 1.23 3.17 0 4.53-2.81 5.52-5.49 5.81.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .31.21.68.83.56A11.81 11.81 0 0 0 24 12.29C24 5.78 18.63.5 12 .5z" />
          </svg>
        </div>
        <h1 className="text-3xl font-extrabold sm:text-4xl">لوحة GitHub</h1>
        <p className="mx-auto mt-3 max-w-xl text-slate-400">
          تكامل مباشر مع GitHub REST API. اربط حسابك واستعرض مستودعاتك العامة والخاصة من لوحة واحدة.
        </p>
      </div>

      <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur sm:p-8">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔐</span>
          <div>
            <h2 className="font-semibold">ربط حساب GitHub بأمان</h2>
            <p className="text-xs text-slate-400">تسجيل الدخول يتم عبر GitHub. لا يتم حفظ Personal Access Token في المتصفح.</p>
          </div>
        </div>
        <button onClick={onConnect} className="mt-5 w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-5 py-3 font-semibold text-white">
          تسجيل الدخول عبر GitHub
        </button>
        <div className="mt-4 rounded-xl bg-slate-950/40 p-4 text-sm text-slate-400">
          الجلسة محمية بـ HttpOnly cookie، والطلبات المعدِّلة تمر عبر خادم التطبيق مع فحص CSRF.
        </div>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-white/10" />
          <span className="text-xs text-slate-500">أو بدون ربط</span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <form onSubmit={(e) => { e.preventDefault(); onPublic(publicUser); }} className="flex gap-2">
          <input
            value={publicUser}
            onChange={(e) => setPublicUser(e.target.value)}
            placeholder="اسم مستخدم عام مثل torvalds"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-indigo-400/60"
            dir="ltr"
          />
          <button className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10">
            حساب عام
          </button>
        </form>

        {error && <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {["مستودعات عامة وخاصة", "بحث وفرز وتصفية", "شجرة الملفات والمحتوى"].map((item) => (
          <div key={item} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center text-sm text-slate-300">{item}</div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [publicMode, setPublicMode] = useState(false);
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("الكل");
  const [sort, setSort] = useState("updated");
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [path, setPath] = useState("");
  const [items, setItems] = useState<RepoItem[]>([]);
  const [file, setFile] = useState<FileResponse | null>(null);
  const [repoLoading, setRepoLoading] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<Event | null>(null);
  const [canInstall, setCanInstall] = useState(false);

  const connect = () => {
    setError("");
    window.location.href="/api/github/auth/start";
  };

  const loadPublic = async (login: string) => {
    const clean = login.trim();
    if (!clean) return;
    setLoading(true);
    setError("");
    try {
      const me = await githubFetch<GitHubUser>(`/users/${clean}`, "");
      const publicRepos = await githubFetch<Repo[]>(`/users/${clean}/repos?per_page=100&sort=updated`, "");
      const events = await githubFetch<Activity[]>(`/users/${clean}/events/public?per_page=20`, "").catch(() => []);
      setUser(me);
      setRepos(publicRepos);
      setActivity(events);
      setPublicMode(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "فشل تحميل الحساب.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      githubFetch<GitHubUser>("/user"),
      fetchAllRepos(),
      githubFetch<Activity[]>("/user/events?per_page=20").catch(() => []),
    ])
      .then(([me, allRepos, events]) => {
        setUser(me); setRepos(allRepos); setActivity(events); setPublicMode(false); setToken("session");
      })
      .catch(() => setToken(""))
      .finally(() => setLoading(false));
  }, []);


  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setCanInstall(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const languages = useMemo(
    () => ["الكل", ...Array.from(new Set(repos.map((r) => r.language).filter(Boolean) as string[])).sort()],
    [repos]
  );

  const filteredRepos = useMemo(() => {
    const q = query.toLowerCase().trim();
    return repos
      .filter((r) => !q || `${r.name} ${r.full_name} ${r.description || ""}`.toLowerCase().includes(q))
      .filter((r) => language === "الكل" || r.language === language)
      .sort((a, b) => {
        if (sort === "stars") return b.stargazers_count - a.stargazers_count;
        if (sort === "forks") return b.forks_count - a.forks_count;
        if (sort === "name") return a.name.localeCompare(b.name);
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      });
  }, [repos, query, language, sort]);

  const totalStars = repos.reduce((sum, r) => sum + r.stargazers_count, 0);
  const totalForks = repos.reduce((sum, r) => sum + r.forks_count, 0);

  const openRepo = async (repo: Repo) => {
    setSelectedRepo(repo);
    setPath("");
    setFile(null);
    setRepoLoading(true);
    setError("");
    try {
      const root = await githubFetch<RepoItem[]>(
        `/repos/${repo.full_name}/contents?ref=${encodeURIComponent(repo.default_branch)}`,
        token
      );
      setItems(root);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر فتح المستودع.");
    } finally {
      setRepoLoading(false);
    }
  };

  const openPath = async (nextPath: string, type: "dir" | "file") => {
    if (!selectedRepo) return;
    setRepoLoading(true);
    setError("");
    try {
      const result = await githubFetch<RepoItem | RepoItem[]>(
        `/repos/${selectedRepo.full_name}/contents/${nextPath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(selectedRepo.default_branch)}`,
        token
      );
      if (type === "dir") {
        setPath(nextPath);
        setFile(null);
        setItems(Array.isArray(result) ? result : []);
      } else {
        setFile(result as FileResponse);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر فتح الملف.");
    } finally {
      setRepoLoading(false);
    }
  };

  const decodeFile = (value: FileResponse) => {
    if (!value.content) return "";
    try {
      const binary = atob(value.content.replace(/\n/g, ""));
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return "تعذر فك محتوى الملف في المتصفح.";
    }
  };

  const logout = async () => {
    try { await fetch("/api/github/auth/logout",{method:"POST",credentials:"include",headers:{"X-CSRF-Token":csrfToken()}}); } catch {}
    setToken(""); setUser(null); setRepos([]); setActivity([]); setSelectedRepo(null); setFile(null);
  };


  const installApp = async () => {
    if (!deferredPrompt) return;
    const prompt = deferredPrompt as Event & { prompt: () => void; userChoice: Promise<{ outcome: string }> };
    prompt.prompt();
    await prompt.userChoice;
    setDeferredPrompt(null);
    setCanInstall(false);
  };

  if (!user && !loading) {
    return (
      <div className="min-h-screen bg-[radial-gradient(125%_125%_at_50%_0%,#1e1b4b_0%,#0f172a_50%,#020617_100%)] text-slate-100">
        <ConnectionScreen onConnect={connect} onPublic={loadPublic} error={error} />
        <footer className="border-t border-white/5 py-6 text-center text-xs text-slate-500">GitHub REST API · الجلسة محمية على الخادم</footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(125%_125%_at_50%_0%,#1e1b4b_0%,#0f172a_50%,#020617_100%)] text-slate-100">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-600">⌘</div>
            <div>
              <h1 className="font-bold">لوحة GitHub</h1>
              <p className="text-[11px] text-slate-500">{publicMode ? "استعراض عام" : "متصل بحسابك"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canInstall && (
              <button onClick={installApp} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300">📲 تثبيت</button>
            )}
            {user && <img src={user.avatar_url} alt={user.login} className="h-8 w-8 rounded-full" />}
            {!publicMode && token && <button onClick={logout} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300">فصل الحساب</button>}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {error && <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

        {selectedRepo ? (
          <section>
            <button onClick={() => setSelectedRepo(null)} className="mb-5 text-sm text-indigo-300 hover:underline">← العودة إلى المستودعات</button>
            <div className="mb-5 rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold" dir="ltr">{selectedRepo.name}</h2>
                  <p className="mt-1 text-sm text-slate-400">{selectedRepo.description || "لا يوجد وصف"}</p>
                </div>
                <a href={selectedRepo.html_url} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 px-4 py-2 text-sm text-indigo-300">فتح على GitHub ↗</a>
              </div>
            </div>

            {repoLoading && <div className="mb-5 text-sm text-slate-400">جارٍ تحميل الملفات...</div>}

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold">الملفات</h3>
                  {path && <button onClick={() => openPath(path.split("/").slice(0, -1).join(""), "dir")} className="text-xs text-indigo-300">مجلد أعلى</button>}
                </div>
                <div className="space-y-1">
                  {items.map((item) => (
                    <button
                      key={item.path}
                      onClick={() => openPath(item.path, item.type)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-sm hover:bg-white/10"
                    >
                      <span>{item.type === "dir" ? "📁" : "📄"}</span>
                      <span className="truncate" dir="ltr">{item.name}</span>
                    </button>
                  ))}
                  {!repoLoading && items.length === 0 && <p className="text-sm text-slate-500">المجلد فارغ.</p>}
                </div>
              </div>

              <div className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                {file ? (
                  <>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="truncate font-semibold" dir="ltr">{file.path}</h3>
                      <a href={file.html_url || selectedRepo.html_url} target="_blank" rel="noreferrer" className="text-xs text-indigo-300">GitHub ↗</a>
                    </div>
                    <pre className="max-h-[70vh] overflow-auto rounded-xl bg-black/30 p-4 text-xs leading-6 text-slate-300" dir="ltr">
                      <code>{decodeFile(file)}</code>
                    </pre>
                  </>
                ) : (
                  <div className="flex min-h-64 items-center justify-center text-center text-sm text-slate-500">
                    اختر ملفًا لعرض محتواه هنا.
                  </div>
                )}
              </div>
            </div>
          </section>
        ) : (
          <>
            <section className="rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-7">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <img src={user!.avatar_url} alt={user!.login} className="h-20 w-20 rounded-2xl border border-white/10" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-2xl font-bold">{user!.name || user!.login}</h2>
                  <a href={user!.html_url} target="_blank" rel="noreferrer" className="text-sm text-indigo-300" dir="ltr">@{user!.login}</a>
                  {user!.bio && <p className="mt-2 text-sm text-slate-300">{user!.bio}</p>}
                </div>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="المستودعات" value={repos.length} icon="📦" />
                <StatCard label="النجوم" value={totalStars} icon="★" />
                <StatCard label="الاشتقاقات" value={totalForks} icon="⑂" />
                <StatCard label="المتابعون" value={user!.followers} icon="👥" />
              </div>
            </section>

            <ZipUploader repos={repos} token={token} onDone={() => { fetchAllRepos(token).then(setRepos).catch(() => {}); }} />
            <AIEngineeringAgent repos={repos} token={token} onDone={() => { fetchAllRepos(token).then(setRepos).catch(() => {}); }} />
            <section className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="flex flex-col gap-3 lg:flex-row">
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث في المستودعات..." className="flex-1 rounded-xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm outline-none focus:border-indigo-400/60" />
                <select value={language} onChange={(e) => setLanguage(e.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm">
                  {languages.map((l) => <option key={l}>{l}</option>)}
                </select>
                <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm">
                  <option value="updated">آخر تحديث</option>
                  <option value="stars">النجوم</option>
                  <option value="forks">الاشتقاقات</option>
                  <option value="name">الاسم</option>
                </select>
              </div>
            </section>

            <section className="mt-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold">كل المستودعات</h2>
                <span className="text-xs text-slate-500">{filteredRepos.length} نتيجة</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredRepos.map((repo) => <RepoCard key={repo.id} repo={repo} onOpen={openRepo} />)}
              </div>
              {filteredRepos.length === 0 && <p className="py-10 text-center text-sm text-slate-500">لا توجد نتائج.</p>}
            </section>

            <section className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-xl font-bold">النشاط الأخير</h2>
              <div className="mt-4 space-y-2">
                {activity.slice(0, 12).map((event) => (
                  <div key={event.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-4 py-3 text-sm">
                    <span className="text-slate-300">{event.type.replace("Event", "")}</span>
                    <span className="truncate text-slate-500" dir="ltr">{event.repo?.name || ""}</span>
                    <span className="shrink-0 text-xs text-slate-600">{formatDate(event.created_at)}</span>
                  </div>
                ))}
                {activity.length === 0 && <p className="text-sm text-slate-500">لا يوجد نشاط متاح.</p>}
              </div>
            </section>
          </>
        )}
      </main>

      <footer className="border-t border-white/5 py-6 text-center text-xs text-slate-500">
        يعمل مباشرة داخل المتصفح · GitHub REST API · لا يوجد خادم وسيط
      </footer>
    </div>
  );
}