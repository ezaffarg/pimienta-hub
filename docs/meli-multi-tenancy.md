# Multi-tenancy

Modelo de tenant e identidad:

> Gobierno: [plan-y-gobierno.md](./plan-y-gobierno.md). Persistencia: [meli-database.md](./meli-database.md). Historial operativo: [índice de prompts de Fase 2](./prompts/phase-02/README.md).

```text
Clerk Organization/Tenant
  -> Client
    -> Store
      -> External Connection -> External Account

Store <- Team / Employee / Manager assignments
```

La Organization activa se obtiene desde `auth()` en servidor. Client, Store, Team, User y asignaciones son conceptos de dominio distintos de los roles de Clerk. Un Client puede tener múltiples Stores y una Store puede asignarse a múltiples Teams, Employees y Managers sin alterar su identidad ni su relación con el Client.

El servidor aplica `User -> Role -> Permission -> Organization Scope -> Store Scope -> Resource` y los repositorios filtran por tenant. En Fase 1, el scope efectivo era Organization; 2.4 agrega el resolver server-only de Store Scope sin reemplazarlo. Una conexión nunca puede reutilizarse entre Organizations. Webhooks futuros resolverán el tenant por la cuenta/conexión almacenada, no desde el payload.

RLS puede reforzar PostgreSQL, pero no sustituye autenticacion Clerk, autorizacion ni validacion de ownership.

## Estado al cierre de Fase 1

El único Resource Scope implementado es Organization. Los mocks tenantizados son almacenamiento temporal para demostrar que `resource.organizationId === context.organizationId`; no representan Client, Store, Team, ownership ni asignaciones reales. En Fase 2, el scope deberá imponerse dentro de repositorios o queries tenant-scoped, no mediante filtrado posterior en memoria.

## Decisiones de diseño aprobadas para Fase 2

`hub_memberships` es la autoridad de roles e-Hub por Organization; Clerk conserva AuthN e identidad. Owner y Manager tienen Store Scope implícito para todas las Stores de su Organization, sujeto a permissions. Employee y Client requieren `store_assignments` explícitos; sin membership o assignment aplicable, el resultado es deny. El bootstrap del primer Owner está implementado con estrategia concurrente; el mapping Clerk sigue como fallback transitorio para usuarios aún no provisionados y no inventa assignments.

`store_assignments` deberá relacionar membership, Store y `organization_id` con FKs compuestas, de modo que no pueda unir entidades de tenants distintos. `storeId` del request solo identifica el objetivo: el servidor comprueba Organization, membership, permiso y Store Scope antes de operar. La defensa primaria será server-only + queries tenant-scoped + constraints; RLS se difiere porque el service role actual la bypassa.

La Subfase 2.1 documenta —sin aplicar todavía— las referencias compuestas `(membership_id, organization_id)` hacia `hub_memberships(id, organization_id)` y `(store_id, organization_id)` hacia `stores(id, organization_id)`. El mismo patrón une cada Connection con su Store. Las consultas y mutaciones futuras deberán incluir `organization_id` en el predicado y operar de forma atómica; la constraint evita que un bug una filas de tenants distintos, pero no sustituye la autorización server-side.

La 2.3 prepara repositorios que no exponen lookup global de Store ni membership por Clerk user sin Organization. La 2.4 añade un resolver explícito: `all-stores` para Owner/Manager y `assigned-stores` para Employee/Client; un scope vacío nunca equivale a todas las Stores. Listados por IDs siguen requiriendo `organization_id` y no hay aún rutas de Store ni DB ejecutada.

La 2.5 agrega el modelo de Connection: Store 1:N Connections y FK compuesta `(store_id, organization_id)`. Provider es el conjunto canónico controlado por código; una cuenta externa solo se reserva globalmente cuando la Connection está `active`. Tokens, OAuth y StoreIntegrationResolver siguen diferidos.
# Bootstrap First Owner

Flujo validado: Usuario autenticado → Clerk → Organization activa → `org:admin` server-side → IDs confiables → RPC bootstrap → advisory transaction lock por Organization → membership Owner persistente. Browser, body, query y formularios no eligen Organization, usuario ni rol. Bootstrap sólo crea el primer Owner; una Organization puede tener uno o más Owners mediante un futuro flujo administrativo. Una membership no-Owner existente no se promociona automáticamente.

## 2.10 — Autoridad primaria de roles persistentes

El flujo canónico de autorización es `usuario autenticado → Organization activa de Clerk → consulta tenant-scoped de hub_memberships(organizationId, clerkUserId) → rol e-Hub → permission → Store Scope`. `hub_memberships` es la autoridad primaria: una membership válida devuelve Owner, Manager, Employee o Client y Clerk no puede sobrescribirla.

El mapping `org:admin → Owner` y `org:member → Employee` permanece sólo como fallback transitorio cuando la consulta de membership terminó correctamente y no encontró fila. Un error de persistencia no equivale a membership ausente: falla cerrado y no intenta fallback. Un rol persistente o Clerk desconocido se deniega. La fuente interna de rol es `persistent` o `clerk-fallback`; no constituye un input ni un dato controlable por el navegador.

Permission y Store Scope continúan separados. Owner y Manager tienen todas las Stores de su Organization; Employee y Client sólo sus assignments explícitos, y un conjunto vacío no concede acceso. La eliminación del fallback requiere provisioning persistente de memberships para los usuarios activos, observación operativa de consultas exitosas sin fallback y una aprobación de cutover; todavía no se cumplen esas condiciones.
# Subfase 2.11 — provisioning controlado

Se preparan primitivas server-only para provisionar memberships persistentes y asignar/revocar Stores. La Organization se deriva exclusivamente del contexto de autorización; el navegador no puede fijarla. El provisioning inicial es Owner-only, valida que el target pertenezca a la Organization Clerk activa y devuelve duplicados controlados sin sobrescribir roles. Employee y Client pueden recibir assignments; Owner y Manager son rechazados. El fallback Clerk continúa vigente hasta una decisión posterior de cutover.
# Checkpoint 2.12 — plan de provisioning real

El provisioning de datos reales permanece bloqueado hasta aprobar la matriz canónica en [docs/provisioning-plan.md](provisioning-plan.md). El fallback Clerk es transicional; no se retira por la planificación. Employee y Client no reciben Store Scope sin assignments persistentes y auditados.

Para la transición del primer Owner, `bootstrap_first_owner` es la única primitive canónica: deriva actor y Organization de Clerk, exige `org:admin`, y no acepta autoridad desde el navegador. El provisioning normal sigue requiriendo un Owner persistente.

La ruta temporal de 2.13 fue retirada tras validar la idempotencia. No queda endpoint operativo de provisioning inicial; `bootstrap_first_owner` y `provisionMembership()` permanecen como primitivas server-only con responsabilidades separadas.
