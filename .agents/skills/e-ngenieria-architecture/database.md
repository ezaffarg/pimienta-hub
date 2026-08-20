# Database

Supabase es infraestructura PostgreSQL; no es identidad.

Modelo inicial:

- `stores`
- `external_connections`
- `external_accounts`
- `external_entities`
- `sync_cursors`
- `webhook_events`
- `sync_runs` o `jobs`
- `integration_errors`

Las tablas deben tener relaciones, constraints, indices y claves unicas compuestas por tenant/provider/account cuando aplique.

Credenciales OAuth deben estar separadas de datos publicables y cifradas en reposo. El acceso a la base se encapsula en repositorios server-only. RLS puede reforzar aislamiento, pero cada operacion sigue validando Clerk y tenant context.