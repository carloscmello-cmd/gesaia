import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listCompanies, getListCompaniesQueryKey } from "@workspace/api-client-react";
import { MessageSquare, Building2, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function InvestigationsPage() {
  const { t } = useTranslation();

  const { data: companies = [], isLoading } = useQuery({
    queryKey: getListCompaniesQueryKey(),
    queryFn: listCompanies,
  });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-primary" />
          {t("investigations.title")}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {t("investigations.subtitle")}
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : companies.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Building2 className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="text-lg font-medium text-foreground">{t("investigations.noCompanies")}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {t("investigations.noCompaniesHint")}
            </p>
            <Link href="/companies">
              <a className="mt-4 inline-flex items-center gap-2 text-sm text-primary hover:underline">
                {t("investigations.goToCompanies")}
              </a>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {companies.map((company) => (
            <Link key={company.id} href={`/companies/${company.id}?tab=investigations`}>
              <a className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer group">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground line-clamp-1">{company.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{company.segment} · {company.activity}</p>
                </div>
                <Badge variant="secondary" className="text-xs flex-shrink-0">
                  {t("investigations.viewInvestigations")}
                </Badge>
                <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary transition-colors flex-shrink-0" />
              </a>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
