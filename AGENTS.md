# AGENTS.md — Spark Refactoring Guide

## Architecture boundaries

Feature-oriented modular monolith. Code lives under `src/`:

- `app/` — application shell, providers, navigation, guards, orchestration hooks
- `features/` — one folder per feature (auth, meetings, calendar, …)
- `shared/` — genuinely cross-feature code (components, hooks, lib, types, utils)
- `integrations/supabase/` — Supabase client and typed access

No microservices. No new state-management libraries. No UI redesign.

## Naming conventions

- Files: `PascalCase` for React components, `camelCase` for hooks and utilities
- Hooks: prefix `use…`
- Services: suffix `…Service` (business logic, no React)
- Repositories: suffix `…Repository` (Supabase access only)
- Mappers: suffix `map…` (DB row → domain model)
- Types: feature-local types in `feature/types/`, shared types in `shared/types/`

## Folder responsibilities

```
feature/
  pages/        Route/page composition only
  components/   Feature UI components
  hooks/        React orchestration and state
  services/     Business operations without JSX
  repositories/ Supabase and external data access
  mappers/      Database-to-domain conversion
  types/        Feature-specific types
  utils/        Pure feature-specific functions
  index.ts      Stable public API when safe
```

- Pages compose components; no large data-access in pages.
- Components must not run complex Supabase queries directly.
- Hooks coordinate UI; they are not business-service containers.
- Services must not import React.
- Repositories own Supabase queries.
- Mappers isolate DB row shapes from UI/domain models.
- Shared code must be reused by ≥2 features.
- No `misc`, `common2`, `helpers2`, or `temp` folders.
- Avoid barrel exports that create circular dependencies.

## Safety invariants

1. Preserve all user-visible behavior and Persian RTL UI.
2. Never change Supabase table names, columns, RPC names, Edge Function names, storage buckets, env vars, permission keys, RLS policies, or API payloads.
3. Never modify the Supabase schema during frontend refactoring.
4. Never change authentication or permission semantics.
5. Permission precedence: admin → legacy user-group → org-level → position overrides.
6. Never delete an old implementation until its replacement is connected and builds pass.
7. Do not introduce new explicit `any` types in newly authored or refactored logic.
   Pre-existing `any` types outside the current task do not expand task scope.
   Do not use `@ts-ignore`, disabled lint rules, or unsafe casts to hide new errors.
8. Preserve URLs, query params, deep links, browser navigation, conference links.
9. Keep every change reviewable and reversible.

## Validation commands

```
npm ci
npm run lint
npm run build
```

During incremental phases, lint only touched TypeScript files.

Newly authored or behavior-refactored files must have zero lint errors and warnings.

For a verified mechanical relocation, the before/after lint baseline must remain identical or improve.

Run the full repository lint only at defined quality milestones.

## Maximum recommended file sizes

| File type          | Lines |
|--------------------|-------|
| App shell          | 200   |
| Page               | 250   |
| UI component       | 200   |
| Hook               | 180   |
| Service/repository | 220   |
| Utility module     | 150   |

Files above 300 lines need a documented reason in `docs/architecture/refactor-plan.md`.

## Supabase access rules

- Keep the existing Supabase client in `src/lib/supabase.ts` (later: `integrations/supabase/`).
- Preserve all query behavior: selected columns, filters, ordering, relation loading, error handling.
- Move queries behind feature repositories incrementally.
- Never combine mutations into a new RPC.
- Never modify RLS.
- Never use the service role in frontend code.
- Never expose secrets.
- Never silently broaden queries.
- When moving a query, compare old and new query chains before deleting old code.

## Permission rules

- Centralize frontend permission loading without changing results.
- Permission loading may query Supabase through the permissions feature.
- The effective permission precedence and result contract must remain unchanged.
- Pure permission checks must operate only on already-loaded permission data.
- Preserve: admin full access, legacy group merging, org-level grants/denials, position overrides, ordering, fallback.
- Do not redesign RBAC in this refactor.

## Rules for future refactoring agents

- Work in small, reversible phases. One phase per change.
- State the files to change (≤8 lines) before editing.
- Make the smallest cohesive change.
- Run lint and build. Fix failures before proceeding.
- Compare behavior against documented invariants.
- Update `docs/architecture/refactor-plan.md` after each phase.
- Stop at the phase boundary.
- If a change requires DB/RLS/auth/API-contract changes, record it as a follow-up risk — do not implement.
