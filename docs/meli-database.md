# Base de datos Mercado Libre

Supabase se usara solo como PostgreSQL. No se usara Supabase Auth.

## Tablas previstas

- `stores`
- `external_connections`
- `external_accounts`
- `external_entities`
- `sync_cursors`
- `webhook_events`
- `sync_runs`/`jobs`
- `integration_errors`

El primer hito necesita principalmente stores, conexiones y cuentas externas. El resto se prepara para fases posteriores.

## Reglas

Agregar tenant key, proveedor, estado, scopes, expiracion, timestamps, auditoria, constraints, indices y claves unicas por tenant/provider/account. Cifrar credenciales OAuth con una clave externa a la base. Usar repositorios server-only y RLS como defensa adicional.