import { expect, test, type Page } from "@playwright/test";

type E2eConfig = {
  appUrl: string;
  clerkSecretKey: string;
  userId: string;
};

type ClerkSignInToken = {
  url: string;
};

type AppResponse = {
  body: string;
  status: number;
};

const CLERK_API_URL = "https://api.clerk.com";

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing ${name}. Configure the dedicated non-production environment before running trend-chart E2E.`,
    );
  }
  return value;
}

function loadConfig(): E2eConfig {
  const appUrl = new URL(requireEnvironment("TREND_CHART_E2E_APP_URL"));
  if (appUrl.protocol !== "http:" && appUrl.protocol !== "https:") {
    throw new Error("TREND_CHART_E2E_APP_URL must use http or https.");
  }

  const clerkSecretKey = requireEnvironment("TREND_CHART_E2E_CLERK_SECRET_KEY");
  if (!clerkSecretKey.startsWith("sk_test_")) {
    throw new Error(
      "TREND_CHART_E2E_CLERK_SECRET_KEY must be an sk_test_ key from the dedicated non-production Clerk tenant.",
    );
  }

  return {
    appUrl: appUrl.toString(),
    clerkSecretKey,
    userId: requireEnvironment("TREND_CHART_E2E_USER_ID"),
  };
}

async function clerkRequest<T>(
  config: E2eConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${CLERK_API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.clerkSecretKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Clerk request ${init.method ?? "GET"} ${path} failed with ${response.status}.`);
  }

  return response.json() as Promise<T>;
}

function appPath(config: E2eConfig, path: string): string {
  return new URL(path, config.appUrl).toString();
}

async function appRequest(
  page: Page,
  config: E2eConfig,
  path: string,
  init: { method: string; body?: unknown },
): Promise<AppResponse> {
  return page.evaluate(
    async ({ url, request }) => {
      const response = await fetch(url, {
        method: request.method,
        credentials: "include",
        headers: request.body === undefined ? undefined : { "Content-Type": "application/json" },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
      });
      return { body: await response.text(), status: response.status };
    },
    { url: appPath(config, path), request: init },
  );
}

async function createAuthenticatedSession(page: Page, config: E2eConfig): Promise<void> {
  const signInToken = await clerkRequest<ClerkSignInToken>(config, "/v1/sign_in_tokens", {
    method: "POST",
    body: JSON.stringify({
      expires_in_seconds: 120,
      user_id: config.userId,
    }),
  });

  await page.goto(signInToken.url);
  await page.goto(config.appUrl);

  await expect.poll(
    async () => (await appRequest(page, config, "/api/users/me", { method: "GET" })).status,
    { message: "The dedicated Clerk user should have an authenticated GESAIA session." },
  ).toBe(200);
}

async function requestJson<T>(
  page: Page,
  config: E2eConfig,
  path: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const response = await appRequest(page, config, path, { method, body });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${method} ${path} failed with ${response.status}: ${response.body}`);
  }
  return response.body ? JSON.parse(response.body) as T : (undefined as T);
}

async function seedTrendFixture(page: Page, config: E2eConfig): Promise<number> {
  const company = await requestJson<{ id: number }>(page, config, "/api/companies", "POST", {
    name: `Trend chart E2E ${Date.now()}`,
    segment: "Tecnologia",
    activity: "Software",
    businessModel: "SaaS",
  });

  const periods = [
    { period: "2025-01", netRevenue: 100, variableCosts: 50, fixedCosts: 20 },
    { period: "2025-02", netRevenue: 100, fixedCosts: 20 },
    { period: "2025-03", netRevenue: 120, variableCosts: 60, fixedCosts: 24 },
    { period: "2025-04", netRevenue: 100, variableCosts: 100, fixedCosts: 20 },
    { period: "2025-05", netRevenue: 140, variableCosts: 70, fixedCosts: 28 },
  ];

  for (const period of periods) {
    await requestJson(page, config, `/api/companies/${company.id}/data`, "PUT", period);
  }

  return company.id;
}

test("keeps safety-margin explanations and gaps visible in the live trend chart", async ({ page }) => {
  const config = loadConfig();
  let companyId: number | undefined;

  try {
    await createAuthenticatedSession(page, config);
    companyId = await seedTrendFixture(page, config);

    await page.goto(appPath(config, `/companies/${companyId}`));
    await page.getByRole("tab", { name: "Evolução" }).click();
    await page.getByRole("button", { name: "Tendência" }).click();
    await page.getByRole("button", { name: "Ver tendência" }).click();

    const safetyMarginChart = page.getByTestId("chart-safety-margin");
    await expect(safetyMarginChart).toBeVisible();

    const missingMarker = page.getByTestId("safety-margin-missing-input-marker-2025-02");
    await expect(missingMarker).toBeVisible();
    await missingMarker.hover();
    await expect(page.getByText("Não calculada: informe Custos Variáveis para este período.")).toBeVisible();

    const notApplicableMarker = page.getByTestId("safety-margin-not-applicable-marker-2025-04");
    await expect(notApplicableMarker).toBeVisible();
    await notApplicableMarker.hover();
    await expect(page.getByText("Não aplicável neste período.")).toBeVisible();

    await expect(page.getByTestId("safety-margin-valid-marker-2025-01")).toBeVisible();
    await expect(page.getByTestId("safety-margin-valid-marker-2025-03")).toBeVisible();
    await expect(page.getByTestId("safety-margin-valid-marker-2025-05")).toBeVisible();
  } finally {
    if (companyId !== undefined) {
      const response = await appRequest(page, config, `/api/companies/${companyId}`, { method: "DELETE" });
      if (response.status !== 204 && response.status !== 404) {
        throw new Error(`DELETE /api/companies/${companyId} failed with ${response.status}: ${response.body}`);
      }
    }
  }
});