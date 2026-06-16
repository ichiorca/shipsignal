---
name: ui-component-conventions
description: How dashboard UI components must be authored so they render under the dependency-free node --test a11y harness
metadata:
  type: project
---

Dashboard UI components live in `app/components/*.ts` (NOT `.tsx`) and are authored with `React.createElement`, not JSX. Reason: the a11y test suite runs under `node --test --experimental-strip-types`, which strips TS types but does NOT transform JSX, and which does NOT resolve the `@/` tsconfig path alias for **runtime** imports.

Two hard rules when adding a component:
- **No JSX in `app/components/*.ts`** — use `createElement`. (Pages in `app/**/page.tsx` DO use JSX; they're only run by Next, not the node harness.)
- **Runtime (value) imports must use relative paths** (`../lib/foo.ts`), never the `@/` alias. Type-only imports (`import type … from '@/app/...'`) are fine — they're erased. Putting a runtime `@/` import in a component throws `ERR_MODULE_NOT_FOUND: Cannot find package '@/app'` in tests.

Corollary: keep pure logic + types in `app/lib/<name>.ts` (no `server-only`/`pg` import) and Aurora reads in `app/lib/db/<name>.ts`. A test importing a runtime value from a `db/*` module fails because that module pulls in `aurora.ts` (which imports `server-only` + `pg`). Mirror the existing `cost.ts`/`db/modelCallTelemetry.ts` and `evalMetrics.ts`/`db/evalRuns.ts` split. See [[oceanic-theme]] for the visual side.

Every a11y test renders the real component via `renderToStaticMarkup` + JSDOM + axe-core, disabling only the `color-contrast` rule (can't evaluate in jsdom). Convey status as TEXT; colour/data-attributes are enhancement only (WCAG 2.2 AA per constitution §6).
