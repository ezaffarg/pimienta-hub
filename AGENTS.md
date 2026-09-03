# AGENTS.md — Manual operativo de agentes

Este archivo define cómo trabajar en **Pimienta Hub**. Es una guía operativa:
no reemplaza la arquitectura, el plan, las reglas ni la documentación técnica.

## 1. Snapshot del proyecto

Pimienta Hub es un SaaS operativo multi-tenant para administrar múltiples
Stores e integraciones e-commerce con aislamiento por Organization.

Stack vigente:

- Next.js 16.2.12 con App Router y React 19.2.4.
- TypeScript estricto, Zod y TanStack.
- Tailwind CSS v4 y shadcn Base Nova sobre Base UI.
- Clerk para identidad y contexto técnico de Organization.
- Supabase PostgreSQL para persistencia.
- Sentry para observabilidad y Recharts para visualización.
- Bun como package manager preferido.

El repositorio deriva de Kiranism como origen/upstream, pero el producto y sus
reglas son los de Pimienta Hub.

## 2. Fuentes, autoridad y conflictos

Las fuentes cumplen funciones diferentes; no existe una precedencia absoluta
capaz de resolver automáticamente toda contradicción:

- **Autoridad normativa:** [REGLAS.md](./REGLAS.md) y
  [plan y gobierno](./docs/plan-y-gobierno.md).
- **Evidencia técnica:** código y tests vigentes.
- **Instrucciones operativas:** este `AGENTS.md`.
- **Detalle técnico:** documentación especializada en `docs/`.
- **Ayudas:** skills locales de `.agents/skills/`.
- **Historia:** [handoff](./docs/codex-handoff.md) y
  [prompts archivados](./docs/prompts/README.md).

El repositorio es la fuente de verdad del estado implementado. Los prompts son
historial operativo, no autorización permanente ni especificación superior.

Si dos fuentes presentan un conflicto material sobre arquitectura, seguridad,
datos, integraciones, alcance o comportamiento, detenerse y reportar la
contradicción. No resolverla silenciosamente por precedencia ni convertir una
suposición en una decisión.

## 3. Lectura mínima antes de trabajar

Antes de modificar el repositorio:

1. Leer [README.md](./README.md) y [REGLAS.md](./REGLAS.md).
2. Leer el [plan y gobierno](./docs/plan-y-gobierno.md), el
   [handoff](./docs/codex-handoff.md) y el
   [workflow de agentes](./docs/agent-workflow.md).
3. Revisar la documentación especializada aplicable al alcance.
4. Revisar código, tests y patrones similares ya implementados.
5. Inspeccionar el working tree y preservar cambios ajenos o preexistentes.
6. Verificar si existe una skill local relevante.

No cargar documentación no relacionada por rutina. Profundizar sólo en las
fuentes necesarias para entender el cambio y sus límites.

## 4. Uso de skills

Las skills locales viven en `.agents/skills/`. Antes de cambiar una parte del
sistema, revisar y usar la skill relevante cuando exista.

Una skill es una ayuda, no autoridad normativa. Debe subordinarse a
`REGLAS.md`, al plan, a decisiones explícitamente aprobadas, a la arquitectura
de Pimienta Hub y a la evidencia vigente del código y los tests.

Si una skill contradice alguna de esas fuentes, detenerse y reportarlo. No
aplicar ciegamente patrones genéricos. Esto es especialmente importante para
`kiranism-shadcn-dashboard`, `next-best-practices`,
`vercel-react-best-practices` y `tanstack-query`: sus recomendaciones sólo
aplican cuando respetan los boundaries de este proyecto.

## 5. Flujo server-side obligatorio

Todo acceso sensible o tenant-scoped debe seguir este orden conceptual:

`Request → Authentication → Authorization → Tenant resolution → Validation → Service → Repository → Database`

- Autenticar y autorizar en servidor.
- Tratar Organization, Store, roles, IDs y filtros recibidos como input no
  confiable hasta validarlos contra el contexto autenticado.
- Resolver tenant y Store Scope antes de ejecutar lógica de negocio.
- Validar payloads en runtime, normalmente con Zod.
- Mantener reglas de negocio en servicios y persistencia en repositories.
- No acceder a la base ni a providers externos directamente desde UI cliente.

## 6. Authentication, autorización y tenancy

Clerk es responsable de:

- authentication y session;
- `userId`;
- Organization activa;
- membership técnica de Clerk Organization.

`hub_memberships` es la autoridad de roles de negocio. Los roles vigentes son:

- `Owner`
- `Manager`
- `Employee`
- `Client`

Store Scope:

- Owner: todas las Stores de la Organization.
- Manager: todas las Stores de la Organization.
- Employee: sólo Stores asignadas.
- Client: sólo Stores asignadas.

Permission y Store Scope son dimensiones independientes. Una acción requiere
que ambas condiciones sean válidas cuando correspondan.

No usar Clerk role, Clerk plan, metadata cliente ni visibilidad de UI como
autorización de negocio. El filtrado de navegación en cliente es sólo UX. Toda
protección efectiva debe repetirse en el servidor.

Cualquier fallback transicional documentado en el código es compatibilidad,
no un reemplazo silencioso del modelo de `hub_memberships`.

## 7. Datos, Supabase y secretos

- Supabase se usa como PostgreSQL/persistencia; no se usa Supabase Auth.
- `service_role` es exclusivamente server-only y nunca llega al navegador.
- El browser no tiene autoridad ni acceso directo privilegiado a la base.
- Todo query y mutation debe estar autenticado, autorizado y tenant-scoped.
- El acceso a datos pasa por repositories y boundaries de infraestructura.
- RLS, constraints, índices y RPCs aportan defensa según el diseño vigente;
  no sustituyen la autorización server-side.
- Tokens y credenciales de integraciones permanecen cifrados y server-only.
- No exponer secretos, tokens, authorization codes, ciphertexts ni headers
  sensibles en cliente, respuestas, logs, trazas, fixtures o documentación.

No introducir ORM ni acceso directo desde frontend como patrón alternativo.
Las migraciones deben respetar aislamiento, integridad e idempotencia y sólo se
aplican remotamente con autorización explícita.

## 8. Boundaries de arquitectura

- `src/features/`: lógica de producto y UI provider-agnostic.
- `src/integrations/`: adapters, clients y comportamiento de providers.
- `src/infrastructure/`: base de datos e infraestructura técnica.

Mercado Libre y otros providers no pertenecen dentro de `features`. Sus DTOs,
errores y contratos se traducen en el boundary de integración; no deben
contaminar features ni modelos internos.

Las páginas y componentes consumen servicios o endpoints internos. Los
servicios coordinan reglas de negocio. Los repositories encapsulan detalles de
persistencia. Mantener estas fronteras antes de crear nuevas abstracciones.

Para Mercado Libre, consultar como mínimo:

- [arquitectura de integraciones](./docs/meli-architecture.md);
- [seguridad de integraciones](./docs/meli-security.md);
- [modelo de datos](./docs/meli-database.md);
- [contratos de API](./docs/meli-api.md).

No realizar OAuth, refresh, sync, migraciones, escrituras al provider ni
validaciones remotas fuera del alcance expresamente autorizado.

## 9. Convenciones de código y UI

- TypeScript estricto; evitar `any` y definir contratos explícitos.
- Server Components por defecto; agregar `'use client'` sólo cuando hooks o
  APIs del navegador lo requieran.
- Respetar la estructura por features y los patrones existentes.
- Usar `cn()` para combinar `className`.
- Usar `PageContainer` para headers de páginas.
- Usar `useAppForm`, `form.AppField` y los shared form fields para formularios.
- Mantener componentes base de shadcn sin modificaciones innecesarias;
  extender o componer cuando sea posible.
- En código productivo nuevo, usar el registro `Icons` de
  `src/components/icons.tsx`. Primitives shadcn existentes pueden conservar
  imports directos legítimos de Tabler cuando forman parte de su implementación.
- No introducir dependencias ni abstracciones especulativas.
- Para copy internacionalizable, seguir el contrato de [i18n](./docs/i18n.md).

## 10. TanStack Query

Patrón vigente para server state:

- Server: `prefetchQuery` + `HydrationBoundary` + `dehydrate`.
- Client: `useSuspenseQuery`.
- Mutations: `useMutation` + `invalidateQueries` mediante keys estables.

Mantener contratos y query options fuera de la UI cuando el feature ya aplica
ese patrón. SWR no es el estándar del proyecto.

## 11. Gobierno del trabajo

- No saltar fases ni implementar fases futuras sin autorización explícita.
- Distinguir siempre **decisión confirmada**, **suposición** y
  **decisión pendiente**.
- Una suposición no puede convertirse en modelo de datos, contrato, migración,
  comportamiento de seguridad o UX sin aprobación.
- Documentar una decisión de arquitectura y su motivo antes de aplicarla.
- Mantener el cambio dentro del scope solicitado; no hacer refactors laterales.
- Preservar el working tree del usuario y evitar sobrescribir cambios ajenos.
- Cumplir la regla **Minimal Diff / No Churn** de `REGLAS.md`: antes del
  checkpoint revisar el diff y eliminar ruido no semántico; si una herramienta
  intenta reescribir o reformatear contenido ajeno, detenerse y usar un parche menor.
- Explicar el alcance antes de cambios masivos y detenerse ante archivos
  inesperados que no puedan atribuirse con seguridad.
- No ejecutar acciones destructivas, remotas o de cierre Git sin autorización.
- Archivar prompts operativos significativos según el workflow cuando el
  alcance permita modificar esa documentación.
- No borrar funcionalidad heredada sólo porque no participe del bloque actual.
- Actualizar documentación especializada cuando cambien contratos o conducta.

## 12. Validación proporcional

Validar en proporción al riesgo y al gate activo:

- Docs-only: revisar `git diff` relevante y ejecutar `git diff --check`.
- Cambio TypeScript pequeño: tests focalizados y `bun run typecheck`.
- Auth, autorización, DB o seguridad: tests relevantes, typecheck y lint.
- Build: ejecutarlo cuando el cierre de fase, el gate o el riesgo lo justifique.

La fase activa puede exigir validaciones adicionales. No sustituirlas por esta
tabla ni repetir validaciones remotas o efectos reales sin autorización.
Registrar con precisión qué se ejecutó, qué se tomó como baseline y qué quedó
pendiente. Un warning informativo no debe presentarse como PASS silencioso.

## 13. Cierre y handoff

Antes de entregar:

- Revisar el diff y confirmar que sólo contiene cambios intencionales propios.
- Reportar archivos modificados, validaciones, resultados y riesgos pendientes.
- No declarar una fase cerrada si falta un gate o existe una contradicción.
- No hacer `git add`, commit o push salvo autorización explícita.
- Dejar el siguiente paso recomendado sin implementarlo cuando así se solicite.

Referencias operativas:

- [README del proyecto](./README.md)
- [Reglas obligatorias](./REGLAS.md)
- [Plan y gobierno](./docs/plan-y-gobierno.md)
- [Handoff vigente](./docs/codex-handoff.md)
- [Workflow de agentes](./docs/agent-workflow.md)
- [Índice de prompts](./docs/prompts/README.md)
