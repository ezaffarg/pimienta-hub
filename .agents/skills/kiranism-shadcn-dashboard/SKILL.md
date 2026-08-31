---
name: kiranism-shadcn-dashboard
description: >-
  Guide for reusing the Kiranism-derived UI patterns in Pimienta Hub:
  dashboard pages, tables, forms, navigation, themes, React Query hydration,
  and shadcn composition. Use for frontend work under the dashboard; do not use
  it as authority for business auth, tenancy, Store Scope, integrations,
  provider access, or database architecture.
---

# Kiranism Dashboard UI Guide

This skill captures reusable UI and starter conventions retained by
Pimienta Hub. It is not an architecture or security skill.

## Authority and scope

Before applying a pattern, read `REGLAS.md`, `AGENTS.md` and the relevant code.
If this skill conflicts with those sources or the approved Pimienta Hub architecture,
stop and report the contradiction.

This skill may guide:

- dashboard routes and `PageContainer`;
- feature UI composition;
- data tables and URL state;
- TanStack Query hydration;
- TanStack Form field composition;
- navigation presentation, themes and icons.

It does **not** govern:

- business authentication or authorization;
- `hub_memberships`, Permission or Store Scope;
- tenant resolution or server-side RBAC;
- integrations or provider clients;
- repositories, schema, RLS or database access;
- OAuth, refresh, sync or provider writes.

Client-side navigation filtering and `PageContainer` access props are UX only.
Every protected operation must enforce the Pimienta Hub server-side authorization
flow independently.

## Where UI code goes

| Task | Location |
| --- | --- |
| Dashboard page | `src/app/dashboard/<name>/page.tsx` |
| Product feature | `src/features/<name>/` |
| Feature components | `src/features/<name>/components/` |
| Provider-agnostic API contracts | `src/features/<name>/api/types.ts` |
| UI-facing service | `src/features/<name>/api/service.ts` |
| Query options and keys | `src/features/<name>/api/queries.ts` |
| Mutation options | `src/features/<name>/api/mutations.ts` |
| Zod schemas | `src/features/<name>/schemas/` |
| Navigation | `src/config/nav-config.ts` |
| Search params | `src/lib/searchparams.ts` |
| Query client | `src/lib/query-client.ts` |
| Form hook | `src/lib/form.ts` |
| Shared form fields | `src/components/forms/fields/` |
| Icons registry | `src/components/icons.tsx` |
| Theme CSS | `src/styles/themes/` |

`src/features/` must remain provider-agnostic. Mercado Libre and other external
providers live in `src/integrations/`; DB access lives in
`src/infrastructure/`. A feature service may call an internal protected API,
but must not become a direct provider or privileged DB client.

## Adding a dashboard feature

1. Inspect a current comparable feature before creating files.
2. Define provider-agnostic types and a Zod schema where runtime input exists.
3. Select the approved data boundary: internal endpoint/service for productive
   data, or an existing mock only for an explicit demo/prototype.
4. Define stable query keys and `queryOptions`.
5. Add mutation options only when the feature actually mutates data.
6. Build Server Components by default and isolate interactive client pieces.
7. Add navigation presentation; do not infer server authorization from it.
8. Validate according to `AGENTS.md` and the active mandate.

Do not create a mock as an automatic first step. Starter mocks are demo
fixtures, not a productive data or security boundary. Product features must not
import mock constants directly from components.

## Page pattern

Use `PageContainer` for page headings and actions:

```tsx
import PageContainer from '@/components/layout/page-container';

export default async function Page() {
  return (
    <PageContainer
      pageTitle='Orders'
      pageDescription='Manage orders.'
      pageHeaderAction={<AddOrderButton />}
    >
      <OrderListing />
    </PageContainer>
  );
}
```

Do not import a separate `<Heading>` into pages. Route auth and business scope
must be enforced server-side outside this presentation pattern.

## TanStack Query

The current standard is:

- Server: `prefetchQuery` + `HydrationBoundary` + `dehydrate`.
- Client: `useSuspenseQuery` with the same query options.
- Mutations: `useMutation` and invalidation through stable query keys.

```tsx
const queryClient = getQueryClient();
void queryClient.prefetchQuery(ordersQueryOptions(filters));

return (
  <HydrationBoundary state={dehydrate(queryClient)}>
    <Suspense fallback={<OrderTableSkeleton />}>
      <OrderTable />
    </Suspense>
  </HydrationBoundary>
);
```

```tsx
'use client';

const { data } = useSuspenseQuery(ordersQueryOptions(filters));
```

Keep query options and key factories outside components. `mutationOptions` may
hold reusable mutation configuration; components execute it with `useMutation`
and layer UI callbacks. See
[query abstractions](references/query-abstractions.md).

SWR is not the project standard. Do not replace `useSuspenseQuery` with
`useQuery` by default.

## Forms

Forms use TanStack Form + Zod through `useAppForm` from `@/lib/form`. Registered
shared fields render inside `form.AppField`:

```tsx
const form = useAppForm({
  defaultValues: { name: '' },
  validators: { onSubmit: orderSchema },
  onSubmit: ({ value }) => mutation.mutate(value)
});

<form
  onSubmit={(event) => {
    event.preventDefault();
    form.handleSubmit();
  }}
>
  <form.AppField
    name='name'
    children={(field) => <field.TextField label='Name' required />}
  />
</form>;
```

Use the registered field components from `src/components/forms/fields/`. For a
one-off control, use the raw form field render pattern and compose the shared
Field primitives. Do not use the removed `useFormFields<T>()` API or import
fields from the old `src/components/ui/tanstack-form` path.

For a form in a Sheet/Dialog, give the native `<form>` an `id` and connect the
footer submit button with its `form` attribute. See
[forms guide](references/forms-guide.md).

## Data tables and URL state

- Use TanStack Table and the shared `DataTable` components.
- Read search params server-side through `searchParamsCache`.
- Read/write client URL state with `nuqs` and `shallow: true` where the current
  table pattern does so.
- Define stable column IDs and use `getSortingStateParser`.
- Keep server filters and client filters structurally identical so hydrated
  query keys match.

Column metadata may drive text, number, range, date, select, multi-select or
boolean filters. Reuse current table examples before adding variants.

## Navigation and access presentation

Navigation lives in `src/config/nav-config.ts` and may hide items based on
Clerk context for UX. That visibility does not authorize a route, resource or
mutation. Do not model Pimienta Hub business roles, Permission or Store Scope from
Kiranism nav properties.

Items without an access presentation rule may remain visible, but the server
still decides whether their operations are allowed.

## Icons, styling and themes

- Use `cn()` for class merging.
- Use Server Components unless hooks or browser APIs require `'use client'`.
- New product code uses `Icons` from `@/components/icons`.
- Existing shadcn primitives may retain legitimate direct Tabler imports.
- Extend or compose base shadcn components instead of editing them casually.
- Preserve Tailwind v4 and the existing theme token structure.

See [theming guide](references/theming-guide.md) and
[charts guide](references/charts-guide.md) only when those tasks apply.

## Demo mocks

The starter's mock APIs remain useful for demos and isolated UI prototypes.
They are not authoritative business data, tenant isolation, RBAC or a pattern
for productive provider features. Read [mock API guide](references/mock-api-guide.md)
only when the user explicitly requests demo/mock behavior.

## Final check

- Page and feature structure match a current repo example.
- Product UI remains provider-agnostic.
- Forms use `@/lib/form` + `form.AppField`.
- Server Query hydration uses `useSuspenseQuery` on the client.
- Navigation access is described as UX only.
- Mocks are not used as productive persistence or authorization.
- `REGLAS.md`, `AGENTS.md` and the active phase remain satisfied.
