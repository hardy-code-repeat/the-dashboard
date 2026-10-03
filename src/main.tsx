import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const Attention = lazy(() => import("./pages/Attention.tsx"));
const AdminControlCenter = lazy(() => import("./pages/AdminControlCenter.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in the browser runtime). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[Preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            {/* D71. This used to say "Preview runtime error" and show a raw
                stack trace to the user. Both were wrong: the panel a person
                lands on after a crash is not a preview, and the trace is for
                whoever is debugging, behind a disclosure rather than in their
                face. The boundary still never renders a blank page. */}
            <p className="text-sm font-semibold">Something went wrong</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              Panel hit an error and stopped rather than showing you something
              half-right. Reloading usually clears it.
            </p>
            {this.state.stack && (
              <details className="mt-4 text-left">
                <summary className="cursor-pointer text-[11px] font-bold uppercase text-muted-foreground underline underline-offset-4">
                  Technical detail
                </summary>
                <p className="mt-2 text-[11px] text-muted-foreground break-words">
                  {this.state.message}
                </p>
                <pre className="mt-2 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                  {this.state.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);



function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      // Only the embedding frame may drive navigation. Without this, **any**
      // window that can obtain a reference to this one — including a page that
      // embeds Panel in an iframe — can send `{type:"navigate"}` and drive the
      // user's history. The preview toolbar *is* the parent frame, so this
      // check costs the feature nothing and closes the listener to strangers.
      if (event.source !== window.parent) return;
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route
                path="/auth"
                element={<AuthPage redirectAfterAuth="/dashboard" />}
              />
              <Route
                path="/dashboard"
                element={
                  <RequireAuth>
                    <Dashboard />
                  </RequireAuth>
                }
              />
              <Route
                path="/attention"
                element={
                  <RequireAuth>
                    <Attention />
                  </RequireAuth>
                }
              />
              {/*
                The internal console. `RequireAuth` here is a convenience, not a
                control: the authorisation is `users.role === "admin"` checked
                in every query handler (ADR-032), and each of the five queries
                refuses independently. The route is deliberately unlinked from
                the user navigation — not because that hides anything, but
                because there is no reason for a user Area to advertise it. A
                signed-in non-admin who types the URL gets a refusal panel.
              */}
              <Route
                path="/control-centre"
                element={
                  <RequireAuth
                    title="Sign in to continue"
                    description="The Control Centre is an internal console and is not linked from the product."
                  >
                    <AdminControlCenter />
                  </RequireAuth>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
