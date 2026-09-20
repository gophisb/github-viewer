import React, { Component, type ErrorInfo, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import App from "../App";
import MissionControl from "./mission-control";
import MissionRuntimeLauncher from "./mission-runtime-launcher";
import "./index.css";

type BoundaryProps = { children: ReactNode; name: string };
type BoundaryState = { error: Error | null };

class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[GitHub Viewer] ${this.props.name} crashed`, error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950 p-6 text-slate-100">
          <div className="w-full max-w-2xl rounded-3xl border border-red-500/30 bg-red-500/5 p-6 shadow-2xl">
            <h1 className="text-xl font-bold text-red-300">تعذر تشغيل هذا الجزء من التطبيق</h1>
            <p className="mt-2 text-sm text-slate-300">{this.props.name}</p>
            <pre className="mt-4 max-h-64 overflow-auto rounded-xl bg-black/40 p-4 text-xs text-red-200" dir="ltr">
              {this.state.error.message}
              {this.state.error.stack ? `\n\n${this.state.error.stack}` : ""}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 rounded-xl bg-red-600 px-4 py-2 text-sm font-bold"
            >
              إعادة تحميل
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary name="لوحة GitHub">
      <App />
    </ErrorBoundary>
    <ErrorBoundary name="Mission Control">
      <MissionControl />
    </ErrorBoundary>
    <ErrorBoundary name="Governed Runtime">
      <MissionRuntimeLauncher />
    </ErrorBoundary>
  </React.StrictMode>
);
