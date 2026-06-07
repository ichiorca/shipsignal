---
description: Scaffold a new React component (Next.js App Router + TypeScript) following project conventions, with typed props and a colocated test.
argument-hint: [ComponentName] [optional/target/dir]
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
---

You are scaffolding a new React component for this Next.js (App Router) + React 19 + TypeScript project, matching the project's existing conventions, types, and a colocated test.

The argument is the component name (PascalCase) and an optional target directory:

    $ARGUMENTS

If no name is given, ask for one. Normalize the name to PascalCase (React requires a capital first letter — lowercase names are treated as HTML tags and won't render).

## 1. Learn the project's conventions FIRST — do not assume

Before writing anything, inspect the repo so the new files blend in:

- Read `package.json` and note the real `scripts` for build, lint, test, and typecheck (e.g. `build`, `lint`, `test`, `typecheck`). Use the names you find — do not invent script names.
- Find 1–2 existing components to mirror. Try `Grep`/`Glob` for `**/*.tsx` under `app/`, `components/`, `src/components/`, or `ui/`. Open the closest match and copy its real patterns: file layout (single file vs folder), named vs `export default`, how props are typed (`interface` vs `type`), styling approach (CSS Modules / Tailwind / styled), and test framework + location.
- Read `tsconfig.json` for the import alias (e.g. `@/components/...`) and use it in imports.
- If conventions conflict with anything below, the project's existing pattern wins.

## 2. Decide Server vs Client component

Server Components are the default in the App Router. Only add the `'use client'` directive (as the very first line) when the component needs client-only features: `useState`/`useEffect`/most hooks, event handlers like `onClick`, browser APIs (DOM, storage, canvas), or context. A pure presentational component should stay a Server Component with NO directive. If unsure, ask whether the component is interactive.

## 3. Create the files

Place files in the target directory from the argument, else the conventional components dir you found in step 1. Match the existing folder-vs-flat layout. A typical folder layout:

    <dir>/<Name>/
      <Name>.tsx        # the component
      <Name>.test.tsx   # the test (match the project's test framework + naming)
      index.ts          # re-export, only if the project uses barrel files

Component file rules (grounded in current React docs):
- Define the component at the **top level** of the file — never nest a component definition inside another component.
- Type props with a `<Name>Props` `interface`/`type` (match the repo). Destructure props in the parameter list and give optional props defaults via `= ` in the destructuring. Mark optional props with `?`. Use `React.ReactNode` for `children` if the component wraps content.
- Return JSX wrapped in parentheses for multi-line returns.
- Export using the project's prevailing style (`export default function <Name>` or a named export).
- Add a `'use client'` first line only if step 2 requires it.

Minimal Server Component starting point (adapt to the repo's style/styling):

    interface <Name>Props {
      title: string;
      children?: React.ReactNode;
    }

    export default function <Name>({ title, children }: <Name>Props) {
      return (
        <section>
          <h2>{title}</h2>
          {children}
        </section>
      );
    }

If it's a Client Component, prepend `'use client';` as line 1.

## 4. Write a real test

Write a colocated test using whatever framework the sibling tests use (e.g. Vitest/Jest + React Testing Library, or the project's Playwright component setup). Do not introduce a new test runner. Cover at least: it renders without crashing, and one prop drives visible output. Mirror the imports and matchers of an existing test file exactly.

## 5. Verify before reporting

Run the project's own commands (the script names from step 1), e.g.:
- typecheck (`npm run typecheck` or `npx tsc --noEmit`)
- lint (`npm run lint`)
- the new test (the project's test script, scoped to the new file if the runner supports it)

Fix anything that fails. Then report: the files created, whether it's a Server or Client component (and why), and the exact command output for typecheck/lint/test. If a step was skipped (e.g. no test runner found), say so explicitly rather than claiming success.
