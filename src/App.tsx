import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { LanguageProvider } from "@/hooks/use-language";
import Index from "./pages/Index";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import InitialSetup from "./pages/InitialSetup";
import NotFound from "./pages/NotFound";
import DesignSystem from "./pages/DesignSystem";
import { lazy, Suspense } from "react";

// Old phone page: separate download, most people never open it
const MobileApp = lazy(() => import("./pages/MobileApp"));
// Dev-only screen harness; the import is dropped from production builds
const MenuSetupDemo = import.meta.env.DEV ? lazy(() => import("./pages/dev/MenuSetupDemo")) : null;
const ReceiveDemo = import.meta.env.DEV ? lazy(() => import("./pages/dev/ReceiveDemo")) : null;
const LoadingDemo = import.meta.env.DEV ? lazy(() => import("./pages/dev/LoadingDemo")) : null;

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, sessionLoading, profile } = useAuth();
  const location = useLocation();
  if (sessionLoading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  // Remember the page so a shared link (/menu-bom) opens after signing in
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (profile?.status === 'Inactive') return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground">
      Your account has been deactivated. Contact your administrator.
    </div>
  );
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  if (user) return <Navigate to={(location.state as { from?: string } | null)?.from ?? "/"} replace />;
  return <>{children}</>;
}

function SetupRoute() {
  const navigate = useNavigate();
  return <InitialSetup onComplete={() => navigate('/login')} />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/setup" element={<SetupRoute />} />
              <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
              <Route path="/mobile" element={<ProtectedRoute><Suspense fallback={null}><MobileApp /></Suspense></ProtectedRoute>} />
              <Route path="/:tab" element={<ProtectedRoute><Index /></ProtectedRoute>} />
              <Route path="/design" element={<DesignSystem />} />
              {MenuSetupDemo && <Route path="/dev/menu-setup" element={<Suspense fallback={null}><MenuSetupDemo /></Suspense>} />}
              {ReceiveDemo && <Route path="/dev/receive" element={<Suspense fallback={null}><ReceiveDemo /></Suspense>} />}
              {LoadingDemo && <Route path="/dev/loading" element={<Suspense fallback={null}><LoadingDemo /></Suspense>} />}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;
