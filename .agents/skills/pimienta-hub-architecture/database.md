# Database

Supabase es infraestructura PostgreSQL; no es identidad ni autorización.

El modelo vigente incluye memberships, Stores, assignments, Connections,
staging OAuth, secretos cifrados, auditoría, Listings y listing sync runs. El
schema exacto y su estado implemented/deferred viven en
`docs/meli-database.md`; no duplicarlos ni inferirlos desde esta skill.

## Invariantes

- Toda fila de negocio tiene tenant key o relación verificable e indexada.
- Organization, Store y Connection se ligan con constraints/FKs compuestas.
- El acceso se encapsula en repositories y RPCs server-only.
- `service_role` nunca llega al browser.
- RLS deny-by-default y grants restringidos refuerzan el boundary vigente.
- RLS no sustituye auth, Permission, Store Scope ni predicates tenant-scoped.
- Credenciales OAuth se almacenan cifradas y separadas de metadata pública.
- Identidades e idempotency keys usan constraints explícitas según el dominio.
- Migrations aplicadas no se editan; toda corrección es forward-only.

No crear tablas genéricas de jobs, métricas o lifecycle por anticipación. Cada
nuevo schema requiere un caso aprobado, constraints, tests y documentación.
