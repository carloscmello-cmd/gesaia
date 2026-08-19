---
name: Isolated release browser checks
description: Security and reliability rules for live third-party browser checks used as release gates
---

Live browser checks that create external accounts or messages should run from a
protected non-production CI environment. Map only the dedicated test tenant's
secrets into the job, install/cache the required browser before the test, and
fail closed when production auth variables are present.

**Why:** The test must exercise a real hosted sign-up flow without exposing
production credentials or allowing a failed cleanup to pass silently.

**How to apply:** Use a dedicated environment and an explicit non-production
marker in the runner; keep production Clerk and application URL variables out
of the job rather than merely avoiding their use in test code.