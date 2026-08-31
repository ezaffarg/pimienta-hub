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

RLS deny-by-default y el privilege hardening vigente refuerzan PostgreSQL sin
policies browser-facing, pero no sustituyen Clerk, autorización ni ownership.

## Estado al cierre de Fase 1

> **SNAPSHOT HISTÓRICO:** este bloque describe el cierre de Fase 1 y no el estado
> persistente actual.

El único Resource Scope implementado es Organization. Los mocks tenantizados son almacenamiento temporal para demostrar que `resource.organizationId === context.organizationId`; no representan Client, Store, Team, ownership ni asignaciones reales. En Fase 2, el scope deberá imponerse dentro de repositorios o queries tenant-scoped, no mediante filtrado posterior en memoria.

## Snapshot histórico — decisiones aprobadas para Fase 2

`hub_memberships` es la autoridad de roles Pimienta Hub por Organization; Clerk conserva AuthN e identidad. Owner y Manager tienen Store Scope implícito para todas las Stores de su Organization, sujeto a permissions. Employee y Client requieren `store_assignments` explícitos; sin membership o assignment aplicable, el resultado es deny. El bootstrap del primer Owner está implementado con estrategia concurrente; el mapping Clerk sigue como fallback transitorio para usuarios aún no provisionados y no inventa assignments.

`store_assignments` deberá relacionar membership, Store y `organization_id` con FKs compuestas, de modo que no pueda unir entidades de tenants distintos. `storeId` del request solo identifica el objetivo: el servidor comprueba Organization, membership, permiso y Store Scope antes de operar. La defensa primaria será server-only + queries tenant-scoped + constraints; RLS se difiere porque el service role actual la bypassa.

La Subfase 2.1 documenta —sin aplicar todavía— las referencias compuestas `(membership_id, organization_id)` hacia `hub_memberships(id, organization_id)` y `(store_id, organization_id)` hacia `stores(id, organization_id)`. El mismo patrón une cada Connection con su Store. Las consultas y mutaciones futuras deberán incluir `organization_id` en el predicado y operar de forma atómica; la constraint evita que un bug una filas de tenants distintos, pero no sustituye la autorización server-side.

La 2.3 prepara repositorios que no exponen lookup global de Store ni membership por Clerk user sin Organization. La 2.4 añade un resolver explícito: `all-stores` para Owner/Manager y `assigned-stores` para Employee/Client; un scope vacío nunca equivale a todas las Stores. Listados por IDs siguen requiriendo `organization_id` y no hay aún rutas de Store ni DB ejecutada.

La 2.5 agrega el modelo de Connection: Store 1:N Connections y FK compuesta `(store_id, organization_id)`. Provider es el conjunto canónico controlado por código; una cuenta externa solo se reserva globalmente cuando la Connection está `active`. Tokens, OAuth y StoreIntegrationResolver siguen diferidos.

## Estado vigente

- La relación operativa es `Organization -> Store -> Connection -> Provider`.
- RLS y privilege hardening están aplicados donde corresponde, sin policies
  browser-facing; `service_role` permanece server-only.
- OAuth Mercado Libre y los tokens cifrados server-side están implementados.
- El browser no es autoridad de tenant, business role, Permission o Store Scope.
- Permanecen diferidos los webhooks, otros dominios/providers y las capacidades
  de sync marcadas como futuras en la documentación vigente.

2.20W-B extiende el mismo aislamiento a evidencia de reconciliation: un Listing
sólo puede referenciar un sync run de su propia Organization, Store y Connection
mediante FK compuesta. Los RPC positivos y terminales repiten los tres predicados
y permanecen exclusivamente bajo `service_role`; no se agregó acceso directo
desde browser. W-C confirmó remotamente los rechazos cross-Organization,
cross-Store y cross-Connection; los fixtures quedaron en 0 y los recursos
reales permanecieron intactos. **2.20W está cerrado.**

# Bootstrap First Owner

Flujo validado: Usuario autenticado → Clerk → Organization activa → `org:admin` server-side → IDs confiables → RPC bootstrap → advisory transaction lock por Organization → membership Owner persistente. Browser, body, query y formularios no eligen Organization, usuario ni rol. Bootstrap sólo crea el primer Owner; una Organization puede tener uno o más Owners mediante un futuro flujo administrativo. Una membership no-Owner existente no se promociona automáticamente.

## 2.10 — Autoridad primaria de roles persistentes

El flujo canónico de autorización es `usuario autenticado → Organization activa de Clerk → consulta tenant-scoped de hub_memberships(organizationId, clerkUserId) → rol Pimienta Hub → permission → Store Scope`. `hub_memberships` es la autoridad primaria: una membership válida devuelve Owner, Manager, Employee o Client y Clerk no puede sobrescribirla.

El mapping `org:admin → Owner` y `org:member → Employee` permanece sólo como fallback transitorio cuando la consulta de membership terminó correctamente y no encontró fila. Un error de persistencia no equivale a membership ausente: falla cerrado y no intenta fallback. Un rol persistente o Clerk desconocido se deniega. La fuente interna de rol es `persistent` o `clerk-fallback`; no constituye un input ni un dato controlable por el navegador.

Permission y Store Scope continúan separados. Owner y Manager tienen todas las Stores de su Organization; Employee y Client sólo sus assignments explícitos, y un conjunto vacío no concede acceso. La eliminación del fallback requiere provisioning persistente de memberships para los usuarios activos, observación operativa de consultas exitosas sin fallback y una aprobación de cutover; todavía no se cumplen esas condiciones.
# Subfase 2.11 — provisioning controlado

Se preparan primitivas server-only para provisionar memberships persistentes y asignar/revocar Stores. La Organization se deriva exclusivamente del contexto de autorización; el navegador no puede fijarla. El provisioning inicial es Owner-only, valida que el target pertenezca a la Organization Clerk activa y devuelve duplicados controlados sin sobrescribir roles. Employee y Client pueden recibir assignments; Owner y Manager son rechazados. El fallback Clerk continúa vigente hasta una decisión posterior de cutover.
# Checkpoint 2.12 — plan de provisioning real

El provisioning de datos reales permanece bloqueado hasta aprobar la matriz canónica en [docs/provisioning-plan.md](provisioning-plan.md). El fallback Clerk es transicional; no se retira por la planificación. Employee y Client no reciben Store Scope sin assignments persistentes y auditados.

Para la transición del primer Owner, `bootstrap_first_owner` es la única primitive canónica: deriva actor y Organization de Clerk, exige `org:admin`, y no acepta autoridad desde el navegador. El provisioning normal sigue requiriendo un Owner persistente.

La ruta temporal de 2.13 fue retirada tras validar la idempotencia. No queda endpoint operativo de provisioning inicial; `bootstrap_first_owner` y `provisionMembership()` permanecen como primitivas server-only con responsabilidades separadas.

## Event intake scope — 2.20X-B

La identidad externa localiza una única Connection activa; Organization y Store
se derivan de ella. La FK compuesta y la RPC repiten el scope completo, rechazan
cruces de tenant/Store/Connection y permanecen bajo `service_role`. El browser
y el envelope del provider no eligen tenant ni Store.

El callback X-C conserva ese boundary: no usa Clerk ni acepta IDs de tenant. Un
body estricto entrega sólo la identidad provider a X-B, que resuelve una única
Connection activa y deriva Organization, Store y Connection antes del intake.

X-D preserva el mismo scope durante procesamiento: el caller entrega sólo el
ID interno del evento; claim y completion revalidan Organization, Store,
Connection, provider y cuenta externa desde filas persistidas. Las FKs
compuestas y locks evitan aplicar un item a otro tenant o binding. El processor
no admite IDs de scope aportados por browser o provider y las RPCs permanecen
exclusivas de `service_role`.

X-E recupera missed feeds para una Connection previamente identificada por
Organization y vuelve a cargarla tenant-scoped. Store, cuenta externa y site no
se aceptan como autoridad del caller: se derivan de Connection y `/users/me`,
se cotejan antes del intake y luego X-B vuelve a resolver el scope persistido.
Un mismatch de Organization, cuenta, aplicación o site falla antes de intake.

X-F deriva cada maintenance run de una Connection activa persistida; el caller
no aporta Organization ni Store. El lock, los selects de backlog y el resumen
repiten el scope completo. La vista administrativa exige sesión, Organization
y membership persistente Owner/Manager; Employee, Client y fallback quedan
denegados. Browser y roles Clerk no obtienen acceso directo a tabla o RPCs.
