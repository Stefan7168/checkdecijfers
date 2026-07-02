# ADR 008 — UI foundation: mainstream React stack, recorded as defaults

**Status:** accepted as implementation defaults, 2026-07-02

## Context

Stefan supplied a UI-stack note (evaluated this session): Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui (on Radix), Recharts, TanStack Table, react-hook-form + zod, Lucide icons, next-themes, sonner toasts, Vercel AI SDK chat primitives. UI choices are mostly low-risk and individually swappable — but leaving them unrecorded means the first build session re-litigates them, and a few of them collide with binding decisions elsewhere in this doc set.

## Decision

Adopt the note's stack as the **default UI foundation**, with four binding constraints inherited from existing decisions:

1. **Two surfaces, two budgets.** Browse/SEO pages are pre-rendered and ship minimal client JavaScript — page performance feeds search ranking, which is that layer's purpose ([04-architecture.md](../04-architecture.md), browse-layer seam). The chat app may use the full interactive shell. Never wrap browse pages in the app shell.
2. **Answers never token-stream** (ADR [004](004-llm-usage.md)). The chat UI streams pipeline *stage-status* only; "regenerate" re-phrases over the same validated results and writes a new audit record — it never re-rolls numbers.
3. **Charts render only from the chart spec via the wrapper** (ADR [007](007-chart-spec-rendering.md)). Recharts is the default client renderer; the Phase 2 static-image/OpenGraph renderer is a separate server-side path over the same spec — do not assume Recharts can produce it.
4. **zod is the single schema layer**: LLM structured outputs (intent, phrasing), validated result objects, chart specs, and forms all validate through the same schemas — one source of truth for every shape, shared by the invariant tests ([05-data-rules.md](../05-data-rules.md)).

**Phase discipline:** Phase 0 UI = chat box + answer card + one chart ([03-mvp-scope.md](../03-mvp-scope.md)). Sidebar/navigation shell, TanStack tables, saved queries, and admin/settings are Phase 1–2 surface.

## Alternatives considered

1. **Heavy enterprise design system** as the foundation. Rejected — slows a solo build, harder to customize, buys patterns (RBAC screens, dense grids) this product doesn't need yet.
2. **Fully custom component library.** Rejected — burns time on commodity accessibility patterns (dialogs, drawers, focus traps) when the differentiator is the data product.
3. **Defer all UI choices to build time.** Rejected — the re-litigation is free to avoid, and constraints 1–4 must bind either way; recording them next to the stack is what prevents a session from violating them by accident.

Note: shadcn/ui is chosen on merits (copy-in components, Tailwind-native, Radix accessibility), *not* because Supabase's UI library uses it — Supabase remains a swappable hosting candidate (ADR [002](002-postgres-system-of-record.md)).

## Consequences

- Mainstream, deeply documented stack: AI sessions are productive immediately and generated code matches ecosystem idiom.
- Every piece swaps cheaply behind its usage site; only the four constraints above are expensive to violate.
- shadcn components are copied into the repo (not a dependency), so upstream churn is opt-in — fits the episodic-session maintenance model ([CLAUDE.md](../../CLAUDE.md) conventions).

## Revisit triggers

- Browse-page performance budget blown (JS payload / Core Web Vitals) → strip client components from that surface first, question the kit second.
- Chart-library limitations obstruct the spec model → swap behind the ADR 007 wrapper (that's what it's for).
- The Phase 2 static-image renderer struggles over the spec → evaluate a server-side charting path (e.g. SVG generation) independent of the client kit.
