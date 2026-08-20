# Informe técnico — e-ngenieria Hub (estado actual)

Este documento fue solicitado por el usuario al agente de Cursor. El pedido fue analizar el repositorio completo **sin modificar archivos**, **sin instalar dependencias**, **sin ejecutar migraciones**, **sin borrar archivos** y **sin hacer refactors**. El análisis se realizó en modo solo lectura y este archivo es el único lugar donde se persiste el informe.

Análisis **solo lectura**. No se modificó ningún archivo, no se instalaron dependencias y no se ejecutaron migraciones.

El repositorio es el starter **Kiranism `next-shadcn-dashboard-starter`**. No hay dominio de ingeniería ni Mercado Libre. El nombre del repo es la única señal de producto.

---

## 1. Framework y versiones principales

| Pieza | Versión |
|---|---|
| Next.js | **16.2.12** (App Router) |
| React / React DOM | **19.2.4** |
| TypeScript | **5.7.2** (strict) |
| Tailwind CSS | **4.2.2** |
| Clerk | **7.3.5** |
| TanStack Query | **5.95.2** |
| TanStack Form | **1.28.5** |
| TanStack Table | **8.21.3** |
| Zod | **4.3.6** |
| Zustand | **5.0.12** |
| nuqs | **2.8.9** |
| Sentry | **10.45.0** |
| shadcn / Base UI | `@shadcn/react` 0.2.1, `@base-ui/react` 1.6.0 |
| Recharts | **3.8.0** |

No hay Prisma, Drizzle, PostgreSQL, Redis ni SDK de Mercado Libre.

---

## 2. Estructura de carpetas

```
e-ngenieria-hub/
├── src/
│   ├── app/                 # App Router (páginas, layouts, API)
│   ├── features/            # Módulos de dominio (demo)
│   ├── components/          # ui, layout, forms, themes, kbar, icons
│   ├── config/              # nav-config, infoconfig
│   ├── hooks/
│   ├── lib/                 # query-client, form, parsers, api-client
│   ├── constants/           # mock-api in-memory
│   ├── styles/themes/       # 10 temas OKLCH
│   ├── types/
│   ├── proxy.ts             # middleware Clerk (Next 16)
│   ├── instrumentation.ts   # Sentry server/edge
│   └── instrumentation-client.ts
├── docs/                    # clerk, forms, themes, rbac, deploy
├── scripts/                 # cleanup.js + templates
├── .agents/skills/          # skills para agentes
├── .claude/skills/          # duplicado/parcial de lo anterior
├── AGENTS.md, CLAUDE.md
├── env.example.txt
├── Dockerfile, Dockerfile.bun
└── components.json          # shadcn style "base-nova"
```

`src/features/` hoy: `auth`, `overview`, `products`, `users`, `kanban`, `chat`, `ai-chat`, `notifications`, `profile`, `forms`, `elements`, `react-query-demo`.

---

## 3. Arquitectura utilizada

Arquitectura **feature-based** con separación:

```
features/<entidad>/
  api/types.ts      → contratos
  api/service.ts    → acceso a datos (único punto a cambiar)
  api/queries.ts    → query keys + queryOptions
  api/mutations.ts  → mutationOptions
  schemas/          → Zod
  components/       → UI
```

Patrón de datos documentado: **mock** actual; preparado para Server Actions + ORM, Route Handlers + ORM, BFF o API externa.

Flujo UI:

- RSC prefetch (`void prefetchQuery`) + `HydrationBoundary`
- Cliente con `useSuspenseQuery`
- URL con nuqs
- Layout dashboard: sidebar + header + infobar + KBar

No hay capa de dominio real ni de integraciones. Los “servicios” llaman mocks en memoria.

---

## 4. Sistema de routing

App Router. Rutas relevantes:

| Ruta | Rol |
|---|---|
| `/` | Redirect: sin sesión → sign-in; con sesión → overview |
| `/auth/sign-in`, `/auth/sign-up` | Catch-all Clerk |
| `/dashboard/*` | Área protegida por middleware |
| `/dashboard/overview` | Parallel routes `@area_stats`, `@bar_stats`, `@pie_stats`, `@sales` |
| `/dashboard/product`, `/users`, `/kanban`, `/chat`, `/ai-chat` | Demos |
| `/dashboard/workspaces`, `/billing`, `/profile`, `/exclusive` | Clerk orgs/billing |
| `/api/products`, `/api/users` | Route handlers CRUD mock |

`src/proxy.ts` (equivalente a middleware en Next 16) protege solo `/dashboard(.*)`. El matcher también cubre `/api` y `/trpc`, pero **no exige login en API**.

---

## 5. Autenticación y autorización

- **AuthN:** Clerk. Dashboard: `auth.protect()`. Landing y `/dashboard` redirigen según `userId`.
- **Orgs:** Clerk Organizations (workspaces, team, `OrgSwitcher`).
- **Billing:** Clerk Billing + `<PricingTable for='organization' />`.
- **Gating de plan:** `<Show when={{ plan: 'pro' }}>` en Exclusive.
- **RBAC de nav:** `nav-config.ts` + `useFilteredNavItems` (cliente). Filtra `requireOrg`, `permission`, `role`. **Plan/feature no se ocultan de verdad** (warning en consola; la página debe proteger).
- **RBAC de servidor:** casi inexistente fuera del middleware de dashboard. Las API no validan sesión, org ni rol.

El propio `AGENTS.md` avisa: el filtro de nav es UX; la seguridad debe ir en servidor. Hoy no está aplicada en handlers.

---

## 6. Clerk — integración concreta

- `ClerkProvider` en `src/components/layout/providers.tsx` (tokens de tema).
- `clerkMiddleware` en `src/proxy.ts`.
- UI: `SignIn` / `SignUp`, `OrganizationList`, `PricingTable`, `useOrganization`, `useAuth`, `useOrganizationList`.
- Redirects en env: after sign-in/up → `/dashboard/overview`.
- Imágenes remotos: `img.clerk.com`, `clerk.com`.
- Keyless mode documentado; `.clerk/` está en `.gitignore`.
- `WEBHOOK_SECRET` en `env.example.txt`, **sin ruta de webhook**.
- Templates de cleanup para quitar Clerk.

Listo para multi-tenant de identidad. No hay sync Clerk → base de datos propia.

---

## 7. Gestión de estado

| Tipo | Herramienta | Uso |
|---|---|---|
| Datos de servidor | TanStack Query | products, users, pokemon demo |
| URL | nuqs | page, perPage, filtros, sort |
| UI local | Zustand | kanban, chat, notifications |
| Tema | cookie + next-themes + ActiveThemeProvider | |
| Sidebar | cookie `sidebar_state` | |
| Formularios | TanStack Form | |

No hay store global de negocio ni sesión propia.

---

## 8. React Query / TanStack

- Singleton `getQueryClient()` en `src/lib/query-client.ts` (`staleTime` 60s; dehydrate de queries `pending`).
- `QueryProvider` envuelve la app.
- Factories: `productKeys.all/list/detail`.
- Mutaciones invalidan `productKeys.all`.
- Tablas cliente: `useDataTable` + `shallow: true` (sin round-trip RSC al paginar).
- Demo Pokémon en `/dashboard/react-query`.

Patrón sólido. Falta: `orgId` en query keys, auth en `queryFn`, errores tipados, optimistic updates reales.

---

## 9. Componentes UI y shadcn / Base UI

- ~70 componentes en `src/components/ui/`.
- `components.json`: estilo **base-nova**, iconos Tabler, aliases `@/`.
- Drawers/dialogs sobre **Base UI**, no Radix (el README lo confirma). `vaul` está en `package.json` y **no se importa**.
- Layout: `PageContainer`, `AppSidebar`, `Header`, `InfoSidebar`, `KBar`.
- Iconos **solo** vía `src/components/icons.tsx`.
- 10 temas OKLCH; default `vercel`.
- Inconsistencia menor: `components.json` apunta CSS a `app/globals.css`; el real es `src/styles/globals.css`.

---

## 10. Formularios y validación

- `useAppForm` = `createFormHook` con fields registrados.
- 15 fields: text, textarea, select, checkbox, switch, radio, slider, combobox, date, otp, color, file, tags, toggle-group, etc.
- Validación Zod `onSubmit` (ej. `productSchema`).
- Demos: basic, multi-step, sheet/dialog, advanced.
- `SubmitButton` usa `isSubmitting`.

Buena base. El schema de producto usa `z.any()` para archivos (débil). No hay formularios de dominio (cotizaciones, publicaciones ML, etc.).

---

## 11. Sistema de tablas

- `useDataTable` (TanStack Table + nuqs): paginación, sort, filtros facetados, pinning, debounce 300ms.
- UI: `data-table*.tsx` (pagination, faceted filter, slider filter, filter clear).
- Columnas por feature: `products/components/product-tables/`, `users/...`.
- Parsers: `getSortingStateParser` en `src/lib/parsers.ts`.
- `searchParamsCache` compartido (page, perPage, name, category, role, sort).

Referencia correcta para listados de proyectos, publicaciones, órdenes.

---

## 12. Sistema de gráficos

- Recharts + wrapper shadcn `src/components/ui/chart.tsx`.
- Overview: area, bar, pie, recent sales.
- Datos **hardcoded** en los componentes (no Query).
- Parallel routes + skeletons + `error.tsx` por slot.

Útil como shell de KPIs; hay que conectar métricas reales.

---

## 13. Manejo de errores

- `global-error.tsx`: captura Sentry, UI inline (sin CSS global).
- `overview/error.tsx` y errores por parallel route.
- Sentry: `register()`, `onRequestError`, `onRouterTransitionStart`.
- `sendDefaultPii: true` y `tracesSampleRate: 1` (agresivo para prod).
- APIs: JSON genérico; 404 en update/delete; **sin** validación Zod del body.
- No hay `not-found` específico por feature más allá de `src/app/not-found.tsx`.

---

## 14. Variables de entorno

Documentadas en `env.example.txt`:

- Clerk: publishable/secret + URLs de auth
- `WEBHOOK_SECRET` (sin uso)
- `BUILD_STANDALONE`
- Sentry: DSN, org, project, auth token, `NEXT_PUBLIC_SENTRY_DISABLED`
- Extra en código: `NEXT_PUBLIC_APP_URL` (metadata)

No hay `DATABASE_URL`, ni keys de Mercado Libre, ni storage.

`.gitignore` ignora `.env*` y `.clerk/`.

---

## 15. Scripts de `package.json`

```
dev, build, start
cleanup          → node scripts/cleanup.js
typecheck        → tsc --noEmit
lint / lint:fix / lint:strict  → oxlint (+ oxfmt en fix)
format / format:check          → oxfmt
prepare          → husky
```

No hay test, migrate, seed ni generate.

---

## 16. Dependencias principales (útiles)

Auth/tenancy: `@clerk/nextjs`  
UI: `@base-ui/react`, `@shadcn/react`, `@tabler/icons-react`, `tailwindcss`, `class-variance-authority`, `clsx`, `tailwind-merge`  
Datos: `@tanstack/react-query`, `@tanstack/react-table`, `@tanstack/react-form`, `zod`, `nuqs`  
App: `next`, `react`, `next-themes`, `sonner`, `kbar`  
Observabilidad: `@sentry/nextjs`  
Tablas/filtros demo: `match-sorter`  
Charts: `recharts`

---

## 17. Dependencias que parecen innecesarias (o solo demo)

| Paquete | Comentario |
|---|---|
| `sort-by` | No hay imports en el repo |
| `vaul` | Drawer usa Base UI |
| `motion` | Sin uso en `src/` |
| `@ai-sdk/react`, `ai` | Solo demo AI Chat |
| `@dnd-kit/*` | Solo Kanban |
| `geist` | `transpilePackages` en next.config; no está en dependencies |
| `@faker-js/faker` | Dev, solo mocks |
| `react-responsive` | No aparece en `src/` |
| `embla-carousel-react` | Solo si se usa `carousel.tsx` |
| `kbar` | Útil, no crítico |
| 9 temas extra | Peso de CSS, no de npm |

Candidatas a recortar cuando se limpie el starter. No son bloqueantes.

---

## 18. `AGENTS.md` y skills

`AGENTS.md` + `CLAUDE.md` definen:

- Feature folders y capa `types → service → queries`
- Prefetch + `useSuspenseQuery` + Suspense
- nuqs, `PageContainer`, `useAppForm`, iconos centralizados
- Clerk orgs/billing, RBAC nav
- No editar `src/components/ui/` directamente
- Formato: comillas simples, sin trailing comma, indent 2

Skills en `.agents/skills/`:

1. `kiranism-shadcn-dashboard` — cómo construir páginas/features en este template
2. `next-best-practices`
3. `vercel-react-best-practices`
4. `vercel-composition-patterns`
5. `shadcn`
6. `tanstack-query`
7. `tanstack-form`
8. `web-design-guidelines`

---

## 19. `.agents`, `.claude` y config de agentes

- `.agents/skills/` y `.claude/skills/` están **duplicados en gran parte** (Vercel/Next/composition). Claude tiene menos (no vi `shadcn`/`tanstack-*` completos como en `.agents`).
- No hay `.cursor/rules` en el repo (`.cursorrules` está gitignored).
- `scripts/cleanup.js` sabe borrar menciones de Clerk/Sentry en docs y AGENTS.
- Convención para humanos y agentes: seguir `AGENTS.md` antes que inventar capas nuevas.

---

## 20. Problemas técnicos y de seguridad

**Altos**

1. **`/api/products` y `/api/users` son públicos.** El middleware corre en `/api` pero no llama `auth.protect()`. Cualquiera puede GET/POST/PUT/DELETE el mock (y mañana la DB si se cablea igual).
2. **Sin aislamiento por organización.** Ni `orgId` en queries, ni filtro en mocks/API.
3. **RBAC de nav no es seguridad.** Plan/feature se muestran igual.
4. **Sentry:** PII por defecto + 100% traces. Coste y privacidad.
5. **No hay webhooks Clerk** pese a `WEBHOOK_SECRET`. Billing/orgs no se sincronizan a un modelo propio.

**Medios**

6. Datos mock en memoria: se pierden al restart; no hay persistencia.
7. `apiClient` no envía cookies/Authorization explícitas (depende de `fetch` same-origin).
8. Bodies de API sin Zod.
9. `productSchema` con `z.any()` para archivos.
10. `gitignore` ignora `package-lock.json` mientras el entorno usa `npm run dev`.
11. Branding/metadata siguen siendo “Shadcn Dashboard”.
12. `console.warn` / `console.error` en nav y org-switcher (`no-console` es warn).

**Bajos**

13. Charts con datos estáticos.
14. Landing mínima (solo redirect).
15. CSS path en `components.json` desalineado.
16. Skills duplicadas `.agents` / `.claude`.

---

## 21. Qué conviene conservar para e-ngenieria Hub

- Next 16 + App Router + layout dashboard (`PageContainer`, sidebar, header, infobar).
- Clerk (login, orgs como tenant de identidad, billing si el modelo es B2B).
- Patrón `features/*/api/{types,service,queries,mutations}`.
- React Query + nuqs + TanStack Table + TanStack Form + Zod.
- `nav-config` + tipos `PermissionCheck` (ampliar con checks de servidor).
- Sistema de temas (un tema propio encima).
- Sentry (reconfigurado).
- Docker + `docs/deployment.md`.
- Registry de iconos y fields de formulario.
- Skills/`AGENTS.md` como guía de implementación.
- Overview como **cáscara** de KPIs, no como datos.

---

## 22. Qué partes probablemente eliminaremos

Con `bun run cleanup` o a mano:

- Kanban, Chat, AI Chat
- Showcase de forms, React Query Pokémon, página de icons
- Products/Users **como dominio** (conservar el patrón, no el catálogo demo)
- Temas extra
- Mocks cuando exista PostgreSQL
- CTA GitHub / branding del template
- `scripts/cleanup*` cuando el producto ya no sea un starter

Kanban solo tiene sentido si el Hub tendrá tablero de proyectos.

---

## 23. Dónde implementar Mercado Libre

**No** en componentes ni en `service.ts` de features de UI.

Recomendación:

```
src/
  integrations/mercadolibre/
    client.ts          # HTTP, OAuth, refresh token, retries, rate limit
    types.ts           # DTOs de la API ML
    webhooks/          # verificación de firma, parseo de notificaciones
    mappers.ts         # ML DTO ↔ modelo de dominio
  app/api/integrations/mercadolibre/
    oauth/callback/route.ts
    webhooks/route.ts
  features/listings/   # (o publicaciones, órdenes)
    api/service.ts     # llama al dominio, NUNCA a fetch ML directo
```

Flujo:

1. Conectar cuenta ML **por organización** (OAuth; tokens cifrados en PostgreSQL, scoped por `orgId`).
2. Route handler de webhook: verifica firma → encola trabajo → responde 200 rápido (`after()` si aplica).
3. Jobs/sync: publicaciones, preguntas, órdenes, stock.
4. UI en `features/listings` o `features/orders` con el patrón Query/tablas existente.

Variables nuevas (no existen hoy): `ML_APP_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI`, `ML_WEBHOOK_SECRET`.

Clerk no sustituye OAuth de ML; Clerk autentica al usuario del Hub, ML es una integración por tenant.

---

## 24. Dónde implementar multi-tenancy

Hoy el tenant de **identidad** es Clerk Organization. Falta el tenant de **datos**.

Capas:

| Capa | Qué hacer |
|---|---|
| Identidad | Conservar Clerk org = empresa/estudio |
| Datos | Columna `org_id` (Clerk org id o UUID interno mapeado) en **todas** las tablas de negocio |
| Query keys | Incluir `orgId`: `listingKeys.list({ orgId, filters })` |
| Server actions / route handlers | `const { orgId, userId } = await auth(); if (!orgId) 403;` filtrar siempre por `orgId` |
| Webhooks ML | Resolver `orgId` desde la cuenta ML vinculada, nunca del body sin verificar |
| Nav/RBAC | Seguir filtrando UI; **repetir** checks en servidor (`auth().has()`, roles Clerk o tabla `memberships`) |
| Storage | Prefijos `org/{orgId}/...` |

Páginas que ya asumen org: billing, teams, exclusive. Extender ese contrato a todo el Hub.

Opcional: tabla `organizations` propia sincronizada por webhook Clerk (`user.created`, `organization.created`, `membership`).

---

## 25. Dónde implementar PostgreSQL

No hay ORM. El punto de enganche previsto es `service.ts` y/o `src/app/api/*/route.ts`.

Recomendación:

```
src/lib/db/                 # cliente Drizzle o Prisma
src/lib/db/schema/          # organizations, users_map, listings, orders, ml_accounts
src/features/<entidad>/api/service.ts  → queries SQL aquí (o repo)
```

Conectividad:

- `DATABASE_URL` en env
- Migraciones fuera de Next (Drizzle Kit / Prisma Migrate)
- En Vercel: pooling (PgBouncer / Neon / Supabase)
- RLS opcional **además** del filtro `org_id` en aplicación

No usar el mock `constants/mock-api*` en producción. Los route handlers actuales deben autenticar antes de tocar la DB.

Para Hub + ML, tablas mínimas típicas: `orgs`, `org_members` (o sync Clerk), `ml_connections` (tokens), `listings`, `orders`, `questions`, `sync_cursors`, `audit_log`.

---

## 26. Arquitectura para separar integraciones de la lógica de negocio

Tres capas, no dos:

```
UI (features/*/components)
        ↓
Application / Domain (features/*/api/service.ts)
  - reglas: “publicar producto”, “reservar stock”, “marcar orden pagada”
  - no conoce URLs de ML ni firmas HMAC
        ↓
Integrations (src/integrations/*)
  - mercadolibre, futuro: AFIP, email, storage
  - client HTTP, auth, webhooks inbound, mappers
        ↓
Persistence (src/lib/db)
```

Reglas:

1. Los componentes nunca importan `@/integrations/mercadolibre`.
2. `service.ts` habla de entidades del Hub.
3. Los webhooks **no** ejecutan reglas largas inline: persisten evento + encolan.
4. Un `integration` puede usarse desde varios features (listings y orders).
5. Contratos internos (`Listing`, `Order`) estables; los DTO de ML cambian detrás del mapper.
6. Errores de ML se traducen a errores de dominio (rate limit, token expirado, publicación inválida).

Esto encaja con el propio comentario del starter: **solo `service.ts` cambia al conectar backend**; las integraciones viven un nivel más abajo para no contaminar el dominio.

---

## Estado actual (una frase)

Es un **admin SaaS-ready de UI y auth**, con Clerk, tablas, forms y Query bien planteados, **sin persistencia, sin tenant de datos, sin APIs protegidas y sin integraciones**.

## Recomendación de camino (sin ejecutar ahora)

1. Conservar el esqueleto (layout, Clerk, Query, forms, tables).
2. Recortar demos.
3. Añadir PostgreSQL + `org_id` y **cerrar `/api` con `auth()`**.
4. Introducir `src/integrations/` antes del primer fetch a Mercado Libre.
5. Modelar features reales (`projects`, `listings`, `orders`) copiando products/users, no reescribiendo la arquitectura.

---

## Actualización posterior — fuente de verdad y plan de ejecución

Las secciones anteriores son un registro histórico del análisis inicial y se conservan para no perder contexto. Algunas afirmaciones describen el estado de ese momento, antes de consolidar la capa preparatoria de integraciones y persistencia; no deben interpretarse como una fotografía actual completa.

Desde esta actualización:

- Existe documentación preparatoria de arquitectura, seguridad, multi-tenancy, base de datos, OAuth, UI e integración de Mercado Libre.
- Existen piezas server-only preparatorias en `src/integrations/`, `src/infrastructure/` y `src/lib/auth/`.
- Supabase está declarado como dependencia y existe un cliente server-only, pero todavía no hay migraciones, repositorios ni persistencia funcional.
- El contrato canónico y la configuración OAuth no constituyen todavía un flujo OAuth implementado.
- Los endpoints demo de products/users continúan siendo mocks y deben tratarse como APIs no listas para producción hasta completar la Fase 1.

El plan vigente está consolidado en [docs/plan-y-gobierno.md](./plan-y-gobierno.md). Ese documento define el orden obligatorio:

1. Decisiones y consolidación.
2. Seguridad base.
3. Persistencia multi-tenant.
4. MVP OAuth de Mercado Libre.
5. UI de conexiones.
6. Adapter y dominio inicial.
7. Sincronización y operaciones.
8. Recorte selectivo del starter y preparación productiva.

Cada fase debe terminar con implementación, typecheck, lint, build, tests, revisión de seguridad, documentación y commit antes de autorizar la siguiente. Los agentes no pueden avanzar solos, saltar fases ni convertir suposiciones en decisiones. Las dudas con impacto arquitectónico deben registrarse como **DECISIÓN PENDIENTE** y consultarse.
