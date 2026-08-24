# Base de datos y migraciones

Supabase se usará únicamente como PostgreSQL; Supabase Auth queda fuera de la arquitectura. La autoridad de tenant llega al servidor desde Clerk y no desde parámetros controlados por el cliente.

## Estado de la Subfase 2.1

**Database Runtime Validation: LOCAL VALIDATED.** Docker y Supabase CLI ejecutaron localmente desde cero las migraciones 2.2 y 2.5 en dos resets reproducibles. La matriz runtime verificó schema, constraints, aislamiento por FKs compuestas, `ON DELETE RESTRICT` y semántica de Connections. No existe link remoto, no se ejecutó `db push` y OAuth permanece diferido. Este documento continúa siendo canónico; ver [checkpoint runtime](./database-runtime-validation.md) para la evidencia de ejecución. Connections no contiene tokens ni secretos.

Bootstrap First Owner está validado localmente por una RPC transaccional con advisory lock por Organization. Una Organization puede tener **uno o más Owners**: el lock serializa únicamente el primer bootstrap y no introduce unicidad permanente. Una membership existente no-Owner no se promociona automáticamente. Remote execution sigue pendiente.

Supabase CLI `2.114.0` está instalada como `devDependency` exacta y se ejecuta con `bunx supabase`; `bunfig.toml` mantiene su política de antigüedad mínima de siete días. El intento documentado de `2.115.0` fue bloqueado por esa política y no se la desactivó. `supabase init` creó la configuración local versionable en `supabase/config.toml`, sin link remoto, credenciales ni schema funcional.

## Convenciones

- Esquema PostgreSQL: `public`; nombres SQL en `snake_case` y tablas en plural.
- Identificadores internos: `uuid`, generados con `gen_random_uuid()` después de garantizar `pgcrypto` en la primera migración.
- Identificadores externos de Clerk y de proveedores: `text`; no se transforman ni se asumen UUID.
- Fechas: `timestamptz NOT NULL DEFAULT now()` para `created_at` y `updated_at`.
- `updated_at` se asignará explícitamente en cada mutación desde los repositorios server-only. No se introduce un trigger genérico en el primer schema.
- Roles, estados y providers se representan como `text` con `CHECK`, no como PostgreSQL enums: cambian sin migraciones de tipo y son consistentes con los contratos TypeScript.
- No se añade `deleted_at` por convención. Las conexiones usan estado controlado; el borrado de memberships y Stores se restringe mientras existan relaciones.

## DDL creado para Subfase 2.2

Este bloque corresponde a la migración versionada, **aún no ejecutada**. La validación real contra una base local queda pendiente de Docker.

```sql
create extension if not exists pgcrypto;

create table public.hub_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clerk_user_id text not null,
  role text not null check (role in ('Owner', 'Manager', 'Employee', 'Client')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_memberships_organization_user_key unique (organization_id, clerk_user_id),
  constraint hub_memberships_id_organization_key unique (id, organization_id)
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  name text not null check (btrim(name) <> ''),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stores_id_organization_key unique (id, organization_id)
);

create index stores_organization_status_idx on public.stores (organization_id, status);

create table public.store_assignments (
  membership_id uuid not null,
  store_id uuid not null,
  organization_id text not null,
  created_at timestamptz not null default now(),
  constraint store_assignments_pkey primary key (membership_id, store_id),
  constraint store_assignments_membership_organization_fkey
    foreign key (membership_id, organization_id)
    references public.hub_memberships (id, organization_id) on delete restrict,
  constraint store_assignments_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id) on delete restrict
);

create index store_assignments_store_membership_idx
  on public.store_assignments (store_id, membership_id);

```

No existe una tabla local de Organizations: `organization_id` referencia la Organization externa de Clerk. Las claves foráneas compuestas de la migración impiden que un assignment relacione memberships y Stores de Organizations distintas. No hay una restricción SQL simple para limitar assignments a Employee/Client sin duplicar el rol: los repositorios posteriores impondrán esa política junto con permiso y Store Scope.

Los nombres de Store no son únicos por Organization: son etiquetas de usuario, no una clave de negocio estable. Un slug o código único solo se añadirá si un caso de producto lo necesita. `connections` está definida en la migración 2.5 y fue validada localmente; tokens OAuth permanecen diferidos a Fase 3.

## Estrategia reproducible de migraciones

La opción recomendada es **A — Supabase CLI como devDependency exacta del proyecto**, invocada con Bun. Evita depender de una instalación global y hace que desarrollo y CI usen la misma versión registrada en `package.json` y `bun.lock`.

| Opción | Evaluación |
| --- | --- |
| A. `supabase` devDependency exacta | Recomendada: queda versionada en el proyecto y reproducible en CI. Requiere aprobación para descargar y cambiar el lockfile. |
| B. `bunx`/`npx` sin dependencia | No recomendada: puede resolver una versión distinta entre ejecuciones o equipos. |
| C. Binario de CI pinneado | Complemento posible en CI, pero no sustituye una herramienta local versionada para el flujo inicial. |

La convención preparada es:

```text
supabase/config.toml
supabase/migrations/<UTC timestamp>_<descripcion_en_snake_case>.sql
```

Ejemplo: `20260821143000_create_hub_tenant_schema.sql`. La CLI debe generar el nombre (`supabase migration new create_hub_tenant_schema`) para evitar colisiones. Cada cambio posterior será una migración nueva y aditiva; no se edita una migración ya aplicada. Una corrección se realiza mediante una migración forward, no mediante rollback destructivo en entornos compartidos.

El flujo reproducible previsto es: crear la migración con la CLI aprobada, arrancar una instancia local de Supabase con Docker, aplicar desde cero mediante `supabase db reset`, inspeccionar el schema/constraints/índices y ejecutar los tests que se creen en 2.2. Esta migración no se ejecutó aún. `supabase link`, `supabase db push`, login y cualquier base remota están fuera de 2.2 y no son parte de la validación inicial.

En este equipo no se detectó Docker, por lo que la validación local no puede prometerse aún. Antes de 2.2 deberá estar disponible un runtime Docker compatible. Una base remota de desarrollo solo podrá evaluarse después de definir acceso, aislamiento y un procedimiento no destructivo; no sustituye la repetición local desde cero.

## Seguridad y límites

- RLS no se crea ni se habilita en esta subfase. La service role puede bypassearla; la defensa primaria posterior será contexto server-side, repositorios tenant-scoped y estas constraints.
- Toda lectura o mutación futura debe recibir `organization_id` desde `ServerAuthorizationContext`, incluirlo en su predicado y ejecutarse atómicamente. `store_id` de URL/body/query solo identifica el objetivo y nunca autoriza el tenant.
- Los repositorios 2.3/2.4 son server-only y exigen `organization_id` en cada lookup, incluso al listar IDs de Store autorizados. El resolver de Store Scope no habilita rutas, guards nuevos, bootstrap de Owner ni conexiones funcionales. La migración aún no fue ejecutada.
- La generación de tipos de base de datos se evaluará cuando el schema exista realmente y haya un contrato de consumo server-side aprobado; no se genera ni se versiona ahora.
