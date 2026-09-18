import { useEffect, useState, useCallback } from "react";

type GitHubUser = {
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
  bio: string | null;
  blog: string;
  location: string | null;
  company: string | null;
  email: string | null;
  public_repos: number;
  public_gists: number;
  followers: number;
  following: number;
  created_at: string;
  twitter_username: string | null;
};

type Repo = {
  id: number;
  name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  fork: boolean;
  updated_at: string;
  topics: string[];
  size: number;
};

const LANG_COLORS: Record<string, string> = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  Java: "#b07219",
  Go: "#00ADD8",
  Rust: "#dea584",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Dart: "#00B4AB",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Vue: "#41b883",
  SCSS: "#c6538c",
  Jupyter: "#DA5B0B",
  Solidity: "#AA6746",
  Lua: "#000080",
};

const fetcher = async (url: string) => {
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (res.status === 404) {
    const err = new Error("لم يتم العثور على المستخدم") as Error & {
      code?: number;
    };
    err.code = 404;
    throw err;
  }
  if (res.status === 403) {
    const err = new Error("تم تجاوز حد الطلبات (GitHub rate limit)") as Error & {
      code?: number;
    };
    err.code = 403;
    throw err;
  }
  if (!res.ok) throw new Error("حدث خطأ أثناء جلب البيانات");
  return res.json();
};

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur transition hover:bg-white/10">
      <div
        className="text-2xl font-bold tabular-nums"
        style={{ color: accent }}
      >
        {value}
      </div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-400">
        {label}
      </div>
    </div>
  );
}

function RepoCard({ repo }: { repo: Repo }) {
  return (
    <a
      href={repo.html_url}
      target="_blank"
      rel="noreferrer"
      className="group flex h-full flex-col rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-indigo-400/50 hover:bg-white/10"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="truncate font-semibold text-slate-100 group-hover:text-indigo-300">
          {repo.name}
        </h4>
        {repo.fork && (
          <span className="shrink-0 rounded-full bg-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-300">
            Fork
          </span>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-sm text-slate-400">
        {repo.description || "لا يوجد وصف"}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {repo.topics.slice(0, 3).map((t) => (
          <span
            key={t}
            className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-medium text-indigo-300"
          >
            {t}
          </span>
        ))}
      </div>
      <div className="mt-auto flex items-center gap-4 pt-3 text-xs text-slate-400">
        {repo.language && (
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: LANG_COLORS[repo.language] || "#8b949e" }}
            />
            {repo.language}
          </span>
        )}
        <span className="flex items-center gap-1">★ {repo.stargazers_count}</span>
        <span className="flex items-center gap-1">⑂ {repo.forks_count}</span>
      </div>
    </a>
  );
}

export default function App() {
  const [query, setQuery] = useState("");
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // منطق تثبيت التطبيق (PWA) على الهاتف
  const [deferredPrompt, setDeferredPrompt] = useState<Event | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    const detect = () => {
      const standalone =
        window.matchMedia?.("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      setIsStandalone(!!standalone);
    };
    detect();

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setCanInstall(true);
    };
    const onInstalled = () => {
      setCanInstall(false);
      setDeferredPrompt(null);
      setIsStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setShowIosHint(isIos && !window.matchMedia("(display-mode: standalone)").matches);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const installApp = async () => {
    if (!deferredPrompt) return;
    const promptEvent = deferredPrompt as Event & {
      prompt: () => void;
      userChoice: Promise<{ outcome: string }>;
    };
    promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === "accepted") {
      setCanInstall(false);
      setDeferredPrompt(null);
    }
  };

  const search = useCallback(async (name: string) => {
    const clean = name.trim();
    if (!clean) return;
    setLoading(true);
    setError("");
    setUser(null);
    setRepos([]);
    try {
      const [userData, repoData] = await Promise.all([
        fetcher(`https://api.github.com/users/${clean}`),
        fetcher(
          `https://api.github.com/users/${clean}/repos?per_page=100&sort=updated`
        ),
      ]);
      setUser(userData);
      setRepos(
        (repoData as Repo[])
          .filter((r) => !r.fork)
          .sort((a, b) => b.stargazers_count - a.stargazers_count)
      );
    } catch (e) {
      const err = e as Error & { code?: number };
      setError(err.message || "حدث خطأ غير متوقع");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    search("torvalds");
  }, [search]);

  // تسجيل أداة العمل (Service Worker) لتفعيل ميزات التطبيق التقدّمي PWA
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch(() => {
          /* التسجيل اختياري — نتجاهل الفشل بهدوء */
        });
      });
    }
  }, []);

  const totalStars = repos.reduce((s, r) => s + r.stargazers_count, 0);

  const langStats = (() => {
    const counts: Record<string, number> = {};
    repos.forEach((r) => {
      if (r.language) counts[r.language] = (counts[r.language] || 0) + 1;
    });
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
    return entries.map(([lang, count]) => ({
      lang,
      count,
      pct: (count / total) * 100,
    }));
  })();

  return (
    <div className="min-h-screen bg-[radial-gradient(125%_125%_at_50%_0%,#1e1b4b_0%,#0f172a_50%,#020617_100%)] text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center">
          <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-600 shadow-lg shadow-indigo-500/30">
            <svg viewBox="0 0 24 24" className="h-8 w-8 fill-current">
              <path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.21 3.44 9.62 8.21 11.18.6.11.82-.25.82-.56 0-.27-.01-1.16-.02-2.1-3.34.71-4.04-1.41-4.04-1.41-.55-1.35-1.34-1.71-1.34-1.71-1.09-.72.08-.71.08-.71 1.21.08 1.84 1.21 1.84 1.21 1.07 1.8 2.81 1.28 3.5.98.11-.76.42-1.28.76-1.57-2.67-.3-5.47-1.31-5.47-5.83 0-1.29.47-2.34 1.24-3.17-.13-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.21a11.6 11.6 0 0 1 6 0c2.29-1.53 3.3-1.21 3.3-1.21.66 1.65.25 2.87.12 3.17.77.83 1.23 1.88 1.23 3.17 0 4.53-2.81 5.52-5.49 5.81.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .31.21.68.83.56A11.81 11.81 0 0 0 24 12.29C24 5.78 18.63.5 12 .5z" />
            </svg>
          </div>
          <h1 className="bg-gradient-to-r from-indigo-300 via-white to-fuchsia-300 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent sm:text-4xl">
            عارض ملف GitHub
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
            أدخل اسم المستخدم على GitHub لعرض ملفه الشخصي ومستودعاته ولغاته
            البرمجية — مدمج مباشرة مع GitHub API.
          </p>
        </div>

        {/* شريط تثبيت التطبيق على الهاتف */}
        {!isStandalone && (canInstall || showIosHint) && (
          <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-indigo-400/30 bg-indigo-500/10 p-4 text-center sm:flex-row sm:justify-between sm:text-right">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📲</span>
              <p className="text-sm text-indigo-100">
                {canInstall
                  ? "ثبّت التطبيق على هاتفك للوصول إليه كأي تطبيق native"
                  : "لتثبيت التطبيق: اضغط مشاركة ثم «أضف إلى الشاشة الرئيسية»"}
              </p>
            </div>
            {canInstall && (
              <button
                onClick={installApp}
                className="shrink-0 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:opacity-90"
              >
                تثبيت التطبيق
              </button>
            )}
          </div>
        )}

        {/* Search */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            search(query);
          }}
          className="mt-8 flex gap-2"
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="مثال: torvalds، facebook، vercel..."
            className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/30"
            dir="ltr"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "جارٍ التحميل..." : "بحث"}
          </button>
        </form>

        {/* Error */}
        {error && (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="mt-10 flex justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400" />
          </div>
        )}

        {/* Profile */}
        {user && !loading && (
          <div className="mt-10 space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur sm:p-8">
              <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
                <img
                  src={user.avatar_url}
                  alt={user.login}
                  className="h-24 w-24 rounded-2xl border-2 border-white/10 shadow-xl"
                />
                <div className="flex-1 text-center sm:text-right">
                  <h2 className="text-2xl font-bold">
                    {user.name || user.login}
                  </h2>
                  <a
                    href={user.html_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-indigo-300 hover:underline"
                    dir="ltr"
                  >
                    @{user.login}
                  </a>
                  {user.bio && (
                    <p className="mt-2 text-sm text-slate-300">{user.bio}</p>
                  )}
                  <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-slate-400 sm:justify-start">
                    {user.company && <span>🏢 {user.company}</span>}
                    {user.location && <span>📍 {user.location}</span>}
                    {user.blog && (
                      <a
                        href={
                          user.blog.startsWith("http")
                            ? user.blog
                            : `https://${user.blog}`
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-indigo-300 hover:underline"
                        dir="ltr"
                      >
                        🔗 {user.blog}
                      </a>
                    )}
                    {user.twitter_username && (
                      <span>𝕏 @{user.twitter_username}</span>
                    )}
                    <span>
                      📅 انضم في{" "}
                      {new Date(user.created_at).toLocaleDateString("ar-EG", {
                        year: "numeric",
                        month: "long",
                      })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="المستودعات" value={user.public_repos} accent="#818cf8" />
                <StatCard label="النجوم" value={totalStars} accent="#fbbf24" />
                <StatCard label="المتابعون" value={user.followers} accent="#34d399" />
                <StatCard label="يتابع" value={user.following} accent="#f472b6" />
              </div>
            </div>

            {/* Languages */}
            {langStats.length > 0 && (
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur sm:p-8">
                <h3 className="text-lg font-semibold text-slate-100">
                  توزيع اللغات
                </h3>
                <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-white/5">
                  {langStats.map((l) => (
                    <div
                      key={l.lang}
                      style={{
                        width: `${l.pct}%`,
                        background: LANG_COLORS[l.lang] || "#8b949e",
                      }}
                      title={`${l.lang}: ${l.count}`}
                    />
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  {langStats.slice(0, 8).map((l) => (
                    <span
                      key={l.lang}
                      className="flex items-center gap-1.5 text-xs text-slate-300"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: LANG_COLORS[l.lang] || "#8b949e" }}
                      />
                      {l.lang} ({l.count})
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Repos */}
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-100">
                  أبرز المستودعات
                </h3>
                <span className="text-xs text-slate-400">
                  {repos.length} مستودع (بدون forks)
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {repos.slice(0, 12).map((repo) => (
                  <RepoCard key={repo.id} repo={repo} />
                ))}
              </div>
              {repos.length === 0 && (
                <p className="text-sm text-slate-400">
                  لا توجد مستودعات عامة غير مشتقّة لعرضها.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <footer className="border-t border-white/5 py-6 text-center text-xs text-slate-500">
        تم بناؤه باستخدام GitHub REST API العامة · React + Vite + Tailwind
      </footer>
    </div>
  );
}
