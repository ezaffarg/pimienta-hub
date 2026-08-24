# Real Provisioning Plan

Status: DRAFT — USER APPROVAL REQUIRED

## Organization

- Clerk Organization auditada: `My Organization` (`org_3I6jn18Q…`).
- Membresías Clerk encontradas: 1.
- Rol Clerk observado: `org:admin`.
- La Organization y el actor siguen siendo autoridad exclusivamente server-side.
- Owner cardinality: **ONE OR MORE**.
- Current real Owners: **1**.
- Safety invariant: **AT LEAST ONE OWNER**.

## Membership Matrix

| Person/Alias | Clerk membership | Current source | Proposed e-Hub role | Action | Approval |
| --- | --- | --- | --- | --- | --- |
| Current Clerk Admin (ID fuera de Git) | `org:admin` | Persistent | Owner | ALREADY PERSISTENT | COMPLETED |

Current business role: **CURRENT REAL OWNER**. Persistent state: **PERSISTENT**. El postcheck remoto confirmó una única fila `Owner` para el Current Clerk Admin y el resolver persistente la prioriza antes del fallback. Idempotence: **VALIDATED** (`created` → `already_exists`, count final `1`). No se registran emails ni identificadores Clerk completos en Git. Owners adicionales están permitidos únicamente mediante acción administrativa explícita.

## Store Assignment Matrix

| Person/Alias | Role | Store | Assignment action | Approval |
| --- | --- | --- | --- | --- |
| Owner candidato | Owner | All Stores del tenant | NOT REQUIRED — ALL STORES | REQUIRED |
| Employee / Client futuros | Employee / Client | No inventar Stores | NEEDS DECISION | REQUIRED |

## Missing Stores

Inventario remoto read-only confirmado: `stores = 0`. **EMPTY — STORE CREATION REQUIRED**. No deben provisionarse Employee ni Client hasta contar con Stores reales auditados y una matriz aprobada.

## Conflicts and blockers

- **SAFE:** `hub_memberships = 1` (Current Owner), `stores = 0`, `store_assignments = 0`, `connections = 0` en el proyecto remoto linked auditado.
- **SAFE:** Current Clerk Admin fue confirmado por decisión humana como Current Real Owner y aprobado para provisioning futuro.
- **BLOCKER:** faltan Stores reales para cualquier Employee/Client.
- **NEEDS DECISION:** Managers, Employees, Clients y sus Stores; no hay base autorizada para inferirlos.
- **SAFE:** la Organization Clerk relevante tiene un único miembro `org:admin`; no se detectó un conflicto Clerk en la consulta realizada.

## Future write plan — not executed

1. Provisionar el Current Clerk Admin como Owner persistente aprobado (CREATE); ejecución aún no autorizada.
2. Crear Stores reales en un checkpoint separado.
3. Definir Managers, Employees y Clients con aprobación humana.
4. Provisionar memberships aprobadas.
5. Crear assignments únicamente para Employee/Client y Stores reales del mismo tenant.
6. Verificar que cada usuario provisionado resuelva `roleSource = persistent`.
7. Ejecutar pruebas funcionales y observar que no quede fallback inesperado.
8. Solicitar aprobación separada antes de retirar el fallback Clerk.

## Idempotency

| Future operation | Classification |
| --- | --- |
| Membership inexistente aprobada | CREATE |
| Membership ya presente con mismo rol | SKIP EXISTING |
| Membership existente con rol distinto | NEEDS UPDATE — separate approved checkpoint |
| Assignment existente | SKIP EXISTING |
| Store o membership fuera del tenant | BLOCKED |

## First Owner transition

La primitive canónica para el **primer Owner persistente** es `bootstrap_first_owner`, invocada exclusivamente desde un contexto Clerk server-side que exige sesión, Organization activa y `org:admin`. Es atómica e idempotente; evita la dependencia circular de exigir un Owner persistente antes de que exista.

`provisionMembership()` permanece como primitive para Owners persistentes posteriores y otros memberships. El endpoint temporal utilizado para la transición fue retirado: no queda una ruta ejecutable de first-owner en el producto.

## Cutover criteria

- Remote DB validated: ✓; inventario real 2.12: ✓ (`0 / 0 / 0 / 0`).
- Bootstrap validated: ✓.
- Persistent role resolver: ✓.
- Provisioning primitives: ✓.
- Store assignment primitives: ✓.
- Real membership matrix approved: ✗.
- Real Stores ready: ✗ (inventario vacío).
- Current Owner persistent: ✓.
- Real memberships created: 1 (Current Owner only).
- Real assignments created: ✗.
- Fallback usage Current Owner: ✓ no longer required; global fallback remains transitional.
- Cutover tests: ✗.
- Rollback plan: ✓ conceptual, pendiente de aprobación.
- Final approval: ✗.

## Rollback plan

El fallback Clerk permanece disponible durante la transición. No se borran memberships ni assignments automáticamente. Ante un fallo se restaura el acceso de forma controlada, se preserva al menos un Owner persistente y cualquier cambio de rol o eliminación requiere un checkpoint explícito y no destructivo.

## Safety confirmation

- Client: sin permisos globales ni acceso a Stores sin assignment explícito.
- Employee: zero assignments implica zero Stores.
- Manager: all-stores del tenant sin assignments, con permisos RBAC existentes.
- Owner: all-stores y provisioning sólo desde contexto server-side.
- Fallback: TRANSITIONAL; su retiro no está autorizado.

References: [Multi-tenancy](meli-multi-tenancy.md), [Database](meli-database.md), [Plan y gobierno](plan-y-gobierno.md), [prompt 2.12](prompts/phase-02/2.12-real-user-provisioning-plan.md).
