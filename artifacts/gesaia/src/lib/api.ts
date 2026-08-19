/**
 * API client configuration.
 *
 * The orval-generated URL helpers already include the /api prefix
 * (e.g. getListCompaniesUrl() returns "/api/companies"), so we only
 * set the origin as base — no /api suffix — to avoid doubling it.
 *
 * In development the Vite proxy forwards /api/* → API server on port 8080.
 * In production both apps share the same origin.
 */
import { setBaseUrl } from "@workspace/api-client-react";

setBaseUrl(window.location.origin);
