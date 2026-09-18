import { useEffect, useState } from "react";
import MissionRuntimePanel from "./mission-runtime-panel";

type Target = { repo: string; branch: string; sha: string; gate: "BLOCK" | "WARN" | "PASS" };

const KEY = "github-mission-control-runtime-target-v1";

function readTarget(): Target {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Target;
  } catch {}
  return { repo: "", branch: "", sha: "", gate: "BLOCK" };
}

export default function MissionRuntimeLauncher() {
  const [target, setTarget] = useState<Target>(readTarget);

  useEffect(() => {
    const timer = window.setInterval(() => setTarget(readTarget()), 1500);
    return () => window.clearInterval(timer);
  }, []);

  return <MissionRuntimePanel {...target} onLog={() => undefined} />;
}
