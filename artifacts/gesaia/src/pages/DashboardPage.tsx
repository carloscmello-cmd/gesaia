import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  listCompanies,
  getListCompaniesQueryKey,
} from "@workspace/api-client-react";
import {
  LayoutDashboard,
  Building2,
  Network,
  MessageSquare,
  Activity,
  TrendingUp,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

function StatCard({
  title,
  value,
  icon: Icon,
  color = "primary",
  loading,
}: {
  title: string;
  value: number | string;
  icon: React.ElementType;
  color?: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-4">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center bg-primary/10 text-primary flex-shrink-0`}
          >
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground font-medium">{title}</p>
            {loading ? (
              <Skeleton className="h-7 w-12 mt-1" />
            ) : (
              <p className="text-2xl font-bold text-foreground">{value}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();

  const { data: dashboard, isLoading: loadingDash } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: companies, isLoading: loadingCo } = useQuery({
    queryKey: getListCompaniesQueryKey(),
    queryFn: listCompanies,
  });

  const loading = loadingDash || loadingCo;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <LayoutDashboard className="w-6 h-6 text-primary" />
          Dashboard
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {t("dashboard.subtitle")}
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          title={t("dashboard.stats.companies")}
          value={dashboard?.totalCompanies ?? companies?.length ?? 0}
          icon={Building2}
          loading={loading}
        />
        <StatCard
          title={t("dashboard.stats.networks")}
          value={dashboard?.totalNetworks ?? 0}
          icon={Network}
          loading={loading}
        />
        <StatCard
          title={t("dashboard.stats.investigations")}
          value={dashboard?.totalInvestigations ?? 0}
          icon={MessageSquare}
          loading={loading}
        />
        <StatCard
          title={t("dashboard.stats.open")}
          value={dashboard?.openInvestigations ?? 0}
          icon={AlertCircle}
          loading={loading}
        />
      </div>

      {/* Companies quick access */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" />
            {t("dashboard.recentCompanies")}
          </h2>
          <Link href="/companies">
            <Button variant="ghost" size="sm">
              {t("dashboard.viewAll")}
            </Button>
          </Link>
        </div>

        {loadingCo ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        ) : companies && companies.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {companies.slice(0, 6).map((company) => (
              <Link key={company.id} href={`/companies/${company.id}`}>
                <Card className="hover:border-primary/50 hover:shadow-md transition-all cursor-pointer group">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Building2 className="w-4 h-4 text-primary" />
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {company.segment}
                      </Badge>
                    </div>
                    <p className="font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-1">
                      {company.name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                      {company.activity}
                    </p>
                    <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <TrendingUp className="w-3 h-3" />
                      <span>
                        {company.businessModel}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Building2 className="w-10 h-10 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground font-medium">{t("dashboard.noCompanies")}</p>
              <p className="text-sm text-muted-foreground/70 mt-1 mb-4">
                {t("dashboard.noCompaniesHint")}
              </p>
              <Link href="/companies">
                <Button size="sm">{t("dashboard.addCompany")}</Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Recent activity placeholder */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            {t("dashboard.recentActivity")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Activity className="w-8 h-8 text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">
              {t("dashboard.activityPlaceholder")}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
