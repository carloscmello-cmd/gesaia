import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ClerkProvider, SignIn, useAuth } from "@clerk/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Route, Switch, Router as WouterRouter } from "wouter";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

// Configure i18n — must be imported before any component that uses t()
import "@/i18n";

// Configure API base URL
import "@/lib/api";

import { getMe, getGetMeQueryKey } from "@workspace/api-client-react";
import AppLayout from "@/components/layout/AppLayout";
import DashboardPage from "@/pages/DashboardPage";
import CompaniesPage from "@/pages/CompaniesPage";
import CompanyDetailPage from "@/pages/CompanyDetailPage";
import NetworksPage from "@/pages/NetworksPage";
import NetworkDetailPage from "@/pages/NetworkDetailPage";
import InvestigationsPage from "@/pages/InvestigationsPage";
import SettingsPage from "@/pages/SettingsPage";
import UsersPage from "@/pages/UsersPage";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;

/** Syncs the user's saved language preference with i18next once loaded. */
function LanguageSync() {
  const { i18n } = useTranslation();
  const { data: me } = useQuery({
    queryKey: getGetMeQueryKey(),
    queryFn: getMe,
  });

  useEffect(() => {
    if (me?.language && me.language !== i18n.language) {
      i18n.changeLanguage(me.language);
    }
  }, [me?.language, i18n]);

  return null;
}

function AuthGuard() {
  const { isSignedIn, isLoaded } = useAuth();
  const { t, i18n } = useTranslation();

  const toggleLanguage = (lang: "pt" | "en") => {
    i18n.changeLanguage(lang);
    localStorage.setItem("gesaia_lang", lang);
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isSignedIn) {
    const currentLang = i18n.language?.startsWith("en") ? "en" : "pt";
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-md">
          <div className="flex justify-end mb-2">
            <div className="flex gap-1 text-xs rounded-md border border-border overflow-hidden">
              {(["pt", "en"] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => toggleLanguage(lang)}
                  className={`px-2 py-1 transition-colors ${
                    currentLang === lang
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {lang === "pt" ? "🇧🇷 PT" : "🇺🇸 EN"}
                </button>
              ))}
            </div>
          </div>
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 mb-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">G</span>
              </div>
              <span className="text-2xl font-bold text-foreground">GESAIA</span>
            </div>
            <p className="text-muted-foreground text-sm">{t("auth.tagline")}</p>
          </div>
          <SignIn routing="hash" />
        </div>
      </div>
    );
  }

  return (
    <>
      <LanguageSync />
      <AppLayout>
        <Switch>
          <Route path="/" component={DashboardPage} />
          <Route path="/companies" component={CompaniesPage} />
          <Route path="/companies/:id" component={CompanyDetailPage} />
          <Route path="/networks" component={NetworksPage} />
          <Route path="/networks/:id" component={NetworkDetailPage} />
          <Route path="/investigations" component={InvestigationsPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/users" component={UsersPage} />
          <Route component={NotFound} />
        </Switch>
      </AppLayout>
    </>
  );
}

function App() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <ClerkProvider publishableKey={publishableKey}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={base}>
            <AuthGuard />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;
