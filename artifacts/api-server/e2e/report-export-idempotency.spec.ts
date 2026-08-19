import { expect, test, type Page, type Route } from "@playwright/test";

type ClerkSignInToken = {
  url: string;
};

type E2eConfig = {
  adminUserId: string;
  appUrl: string;
  clerkSecretKey: string;
};

type BrowserApiResponse = {
  body: string;
  status: number;
};

type Company = {
  id: number;
  name: string;
};

type Report = {
  id: number;
  type: string;
};

const CLERK_API_URL = "https://api.clerk.com";
const ME_PATH = "/api/users/me";
const PRODUCTION_ENVIRONMENT_VARIABLES = [
  "CLERK_SECRET_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "VITE_CLERK_PUBLISHABLE_KEY",
] as const;

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing ${name}. See docs/invitation-revocation-browser-test.md for the isolated E2E configuration.`,
    );
  }
  return value;
}

function loadConfig(): E2eConfig {
  if (requireEnvironment("INVITATION_E2E_ENVIRONMENT") !== "non-production") {
    throw new Error(
      "INVITATION_E2E_ENVIRONMENT must be non-production; this suite only runs against the isolated test environment.",
    );
  }

  const productionEnvironmentVariable = PRODUCTION_ENVIRONMENT_VARIABLES.find(
    (name) => process.env[name]?.trim(),
  );
  if (productionEnvironmentVariable) {
    throw new Error(
      `${productionEnvironmentVariable} must not be available to the report E2E job; use only the dedicated non-production Clerk secret.`,
    );
  }

  const appUrl = new URL(requireEnvironment("INVITATION_E2E_APP_URL"));
  if (appUrl.protocol !== "http:" && appUrl.protocol !== "https:") {
    throw new Error("INVITATION_E2E_APP_URL must use http or https.");
  }

  const clerkSecretKey = requireEnvironment("INVITATION_E2E_CLERK_SECRET_KEY");
  if (!clerkSecretKey.startsWith("sk_test_")) {
    throw new Error(
      "INVITATION_E2E_CLERK_SECRET_KEY must be an sk_test_ key from the dedicated non-production Clerk tenant.",
    );
  }

  return {
    appUrl: appUrl.toString(),
    clerkSecretKey,
    adminUserId: requireEnvironment("INVITATION_E2E_ADMIN_USER_ID"),
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
    throw new Error(
      `Clerk request ${init.method ?? "GET"} ${path} failed with ${response.status}.`,
    );
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
): Promise<BrowserApiResponse> {
  return page.evaluate(
    async ({ url, request }) => {
      const response = await fetch(url, {
        method: request.method,
        credentials: "include",
        headers:
          request.body === undefined
            ? undefined
            : { "Content-Type": "application/json" },
        body:
          request.body === undefined ? undefined : JSON.stringify(request.body),
      });
      return { body: await response.text(), status: response.status };
    },
    { url: appPath(config, path), request: init },
  );
}

async function createAuthenticatedSession(
  page: Page,
  config: E2eConfig,
): Promise<void> {
  const signInToken = await clerkRequest<ClerkSignInToken>(
    config,
    "/v1/sign_in_tokens",
    {
      method: "POST",
      body: JSON.stringify({
        expires_in_seconds: 120,
        user_id: config.adminUserId,
      }),
    },
  );

  await page.goto(signInToken.url);
  await page.goto(config.appUrl);
  await expect
    .poll(
      async () =>
        (await appRequest(page, config, ME_PATH, { method: "GET" })).status,
      {
        message:
          "The dedicated Clerk admin should have an authenticated app session.",
      },
    )
    .toBe(200);
}

async function createCompany(page: Page, config: E2eConfig): Promise<Company> {
  const companyName = `PDF Retry Regression ${Date.now()}`;
  const response = await appRequest(page, config, "/api/companies", {
    method: "POST",
    body: {
      name: companyName,
      segment: "Tecnologia",
      activity: "Teste de exportação",
      businessModel: "B2B",
    },
  });
  expect(response.status).toBe(201);
  return JSON.parse(response.body) as Company;
}

async function getReports(
  page: Page,
  config: E2eConfig,
  companyId: number,
): Promise<Report[]> {
  const response = await appRequest(
    page,
    config,
    `/api/reports/${companyId}/reports`,
    {
      method: "GET",
    },
  );
  expect(response.status).toBe(200);
  return JSON.parse(response.body) as Report[];
}

test("a lost PDF response does not duplicate the saved report", async ({
  browser,
}) => {
  const config = loadConfig();
  const context = await browser.newContext();
  const page = await context.newPage();
  let company: Company | undefined;
  let primaryFailure: unknown;
  let firstResponseDropped = false;

  const dropFirstPdfResponse = async (route: Route) => {
    if (firstResponseDropped) {
      await route.continue();
      return;
    }

    firstResponseDropped = true;
    // route.fetch() waits for the server response, so persistence has completed
    // before the browser sees the intentionally dropped response.
    await route.fetch();
    await route.abort("failed");
  };

  try {
    await createAuthenticatedSession(page, config);
    company = await createCompany(page, config);

    await page.goto(appPath(config, `/companies/${company.id}`));
    await expect(
      page.getByRole("heading", { name: company.name }),
    ).toBeVisible();

    await page.route("**/api/reports/pdf", dropFirstPdfResponse);
    await page.getByRole("button", { name: "Exportar PDF" }).click();
    await expect
      .poll(async () => (await getReports(page, config, company!.id)).length, {
        message:
          "The first PDF response should be lost only after its report is persisted.",
      })
      .toBe(1);
    await expect(
      page.getByRole("button", { name: "Exportar PDF" }),
    ).toBeEnabled();
    expect(firstResponseDropped).toBe(true);

    await page.unroute("**/api/reports/pdf", dropFirstPdfResponse);
    await page.getByRole("button", { name: "Exportar PDF" }).click();
    await expect
      .poll(async () => (await getReports(page, config, company!.id)).length, {
        message:
          "Retrying the lost PDF response must reuse the persisted report.",
      })
      .toBe(1);

    await page.getByRole("tab", { name: "Relatórios" }).click();
    await expect(page.getByText("1 relatório gerado")).toBeVisible();
    await expect(page.getByRole("button", { name: "Baixar PDF" })).toHaveCount(
      1,
    );

    const [savedReport] = await getReports(page, config, company.id);
    expect(savedReport).toBeDefined();
    const [downloadResponse] = await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes(`/api/reports/${savedReport.id}/download`),
      ),
      page.getByRole("button", { name: "Baixar PDF" }).click(),
    ]);
    expect(downloadResponse.status()).toBe(200);
    expect(downloadResponse.headers()["content-type"]).toContain(
      "application/pdf",
    );
    expect((await downloadResponse.body()).subarray(0, 4).toString()).toBe(
      "%PDF",
    );

    await page.getByRole("button", { name: "Exportar PDF" }).click();
    await expect
      .poll(async () => (await getReports(page, config, company!.id)).length, {
        message: "A later intentional export should create a second report.",
      })
      .toBe(2);
    await expect(page.getByText("2 relatórios gerados")).toBeVisible();
    await expect(page.getByRole("button", { name: "Baixar PDF" })).toHaveCount(
      2,
    );
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    const cleanupFailures: string[] = [];

    if (company) {
      try {
        const response = await appRequest(
          page,
          config,
          `/api/companies/${company.id}`,
          {
            method: "DELETE",
          },
        );
        if (response.status !== 204) {
          cleanupFailures.push(
            `company cleanup returned ${response.status}: ${response.body}`,
          );
        }
      } catch (error) {
        cleanupFailures.push(
          `company cleanup: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    await context.close();

    if (!primaryFailure && cleanupFailures.length) {
      throw new Error(
        `Report export E2E cleanup failed:\n${cleanupFailures.join("\n")}`,
      );
    }
  }
});
