import React, { Component, type ErrorInfo, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import App from "../App";
import "./index.css";

type Props = { children: ReactNode };
type State = { error: Error | null };

class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("GitHub Viewer runtime error:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="min-h-screen bg-slate-950 p-6 text-white" dir="rtl">
          <div className="mx-auto max-w-3xl rounded-2xl border border-red-500/40 bg-red-950/40 p-6">
            <h1 className="text-xl font-bold text-red-300">حدث خطأ أثناء تشغيل التطبيق</h1>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm text-red-100">
              {this.state.error.message}
            </p>
            <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/30 p-4 text-xs text-red-200">
              {this.state.error.stack || "لا توجد معلومات إضافية."}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="mt-5 rounded-xl bg-red-500 px-5 py-3 font-semibold text-white"
            >
              إعادة تحميل
            </button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("لم يتم العثور على عنصر root في الصفحة.");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
