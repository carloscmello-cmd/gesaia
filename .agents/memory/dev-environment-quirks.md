---
name: Dev environment quirks
description: Durable gotchas when typechecking and validating in this monorepo
---

- **Stale project references:** after editing a `lib/*` package's source, rebuild it (`tsc -b` in that package) before typechecking dependents — otherwise dependents resolve stale `dist/` typings and report phantom missing exports.
  **Why:** api-server consumes lib/db via TS project references + prebuilt d.ts.
- **Auth-gated APIs:** every API route requires a Clerk session, so curl always gets 401 in dev. Validate server logic by exporting pure helpers and exercising them in a script instead of hitting HTTP.
- **Native route tests:** Node's strip-types runner cannot load route modules that transitively import the database package because its source uses directory imports. Keep database-free transformation logic in pure modules and test those directly.
  **Why:** importing an Express route for a unit test can fail during ESM resolution before the test executes.
- **Database-free HTTP route tests:** For route-level coverage under the native runner, extract the focused handler into an injectable router and supply an in-memory query adapter plus table tokens in the test.
  **Why:** this retains a real HTTP request while avoiding the database package's unsupported source imports and any live database dependency.
- **OpenAPI string formats:** The installed generator emits unavailable Zod v4 helpers for `date-time` and `email` formats.
  **Why:** contract code generation succeeds but the follow-on library typecheck fails against the current Zod version.
  **How to apply:** keep timestamps as plain strings; when an email format is needed, maintain the codegen postprocessor's `zod.email()` → `zod.string().email()` conversion.
- **Isolated API generation:** Orval resolves custom mutators relative to the generated output directory.
  **Why:** a temporary output directory needs a matching copy of the non-generated mutator; otherwise generation fails or produces false contract drift from a changed import path.
  **How to apply:** stage the mutator in the temporary workspace before running a non-mutating generation check.
- Some TS errors in the web app predate current work and are tracked by their own task — verify a failure touches your files before treating it as a regression.
- **PDF delta arrows:** `pdftotext` can decode the embedded ▲ glyph as a different character.
  **Why:** its extraction depends on the PDF font encoding, not the visible rendered glyph.
  **How to apply:** assert stable numeric delta text in PDF integration tests and retain direct unit tests for the exact `scorecardDeltaLabel` arrow string.
- **PDF narrative extraction:** `pdftotext -layout` inserts visual line breaks inside long sentences.
  **Why:** PDF text layout does not preserve source-line boundaries.
  **How to apply:** normalize whitespace for content assertions, but retain form-feed page boundaries when testing pagination.
