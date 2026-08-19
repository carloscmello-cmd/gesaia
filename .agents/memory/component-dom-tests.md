---
name: Component DOM tests
description: Runtime requirement for mounting React components directly with the repository's tsx test runner
---

- **Rule:** When a test mounts a TSX component with the direct `tsx --test` runner, ensure the rendered component module has a default `React` import.
  **Why:** The runner uses the classic JSX transform for these modules, unlike Vite's automatic JSX runtime, so JSX otherwise fails at runtime with `React is not defined`.
  **How to apply:** Add the default import only to components directly mounted by Node-based DOM tests; Vite production behavior is unchanged.