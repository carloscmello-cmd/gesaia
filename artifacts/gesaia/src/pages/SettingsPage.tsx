import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { useTranslation } from "react-i18next";
import { Settings, User, Globe, Save, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { getMe, getGetMeQueryKey, useUpdateMe } from "@workspace/api-client-react";

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { user: clerkUser } = useUser();

  const { data: me } = useQuery({
    queryKey: getGetMeQueryKey(),
    queryFn: getMe,
  });

  // Editable state — undefined until me loads so we don't stomp the real value
  const [name, setName] = useState<string>("");
  const [language, setLanguage] = useState<"pt" | "en" | undefined>(undefined);
  // Track whether the user has deliberately changed each field in this session
  const [nameDirty, setNameDirty] = useState(false);
  const [langDirty, setLangDirty] = useState(false);

  // Once me loads, initialize form fields (but never overwrite a dirty user edit)
  useEffect(() => {
    if (!me) return;
    if (!nameDirty) setName(me.name ?? "");
    if (!langDirty) setLanguage(me.language ?? "pt");
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateMut = useUpdateMe({
    mutation: {
      onSuccess: (_, variables) => {
        qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
        // Reset dirty flags after a successful save
        setNameDirty(false);
        setLangDirty(false);
        // Apply language change immediately in the UI and persist for logged-out sessions
        const newLang = variables.data.language;
        if (newLang) {
          i18n.changeLanguage(newLang);
          localStorage.setItem("gesaia_lang", newLang);
        }
        toast({ title: t("settings.toasts.saved") });
      },
      onError: () => toast({ title: t("settings.toasts.saveError"), variant: "destructive" }),
    },
  });

  // The effective language shown in the selector — fall back to me?.language or current i18n locale
  const effectiveLang: "pt" | "en" =
    language ?? (me?.language as "pt" | "en" | undefined) ?? (i18n.language as "pt" | "en") ?? "pt";

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Settings className="w-6 h-6 text-primary" />
          {t("settings.title")}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">{t("settings.subtitle")}</p>
      </div>

      <div className="space-y-4">
        {/* Profile card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <User className="w-4 h-4 text-primary" />
              {t("settings.profile")}
            </CardTitle>
            <CardDescription>{t("settings.accountInfo")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4 p-3 bg-muted/30 rounded-lg">
              {clerkUser?.imageUrl && (
                <img
                  src={clerkUser.imageUrl}
                  alt={clerkUser.fullName ?? ""}
                  className="w-12 h-12 rounded-full object-cover"
                />
              )}
              <div>
                <p className="font-semibold text-foreground">
                  {clerkUser?.fullName ?? clerkUser?.emailAddresses[0]?.emailAddress}
                </p>
                <p className="text-sm text-muted-foreground">
                  {clerkUser?.emailAddresses[0]?.emailAddress}
                </p>
              </div>
              {me?.role && (
                <Badge variant="outline" className="ml-auto text-xs">
                  {me.role}
                </Badge>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="name">{t("settings.displayName")}</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameDirty(true);
                }}
                placeholder={t("settings.namePlaceholder")}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("settings.language")}</Label>
              <Select
                value={effectiveLang}
                onValueChange={(v) => {
                  setLanguage(v as "pt" | "en");
                  setLangDirty(true);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pt">🇧🇷 Português</SelectItem>
                  <SelectItem value="en">🇺🇸 English</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={() =>
                updateMut.mutate({
                  data: {
                    name: name || undefined,
                    language: effectiveLang,
                  },
                })
              }
              disabled={updateMut.isPending}
            >
              {updateMut.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              {t("settings.saveChanges")}
            </Button>
          </CardContent>
        </Card>

        {/* Platform info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />
              {t("settings.platform")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">{t("settings.version")}</p>
                <p className="font-medium text-foreground">GESAIA v1.0</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{t("settings.engines")}</p>
                <p className="font-medium text-foreground">{t("settings.enginesValue")}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{t("common.ai")}</p>
                <p className="font-medium text-foreground">{t("settings.aiValue")}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{t("common.languages")}</p>
                <p className="font-medium text-foreground">{t("settings.languagesValue")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
