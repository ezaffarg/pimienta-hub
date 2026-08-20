# Sync strategy

La sincronizacion no pertenece al primer hito.

La estrategia futura sera webhook-first con reconciliacion:

1. backfill inicial paginado;
2. cursor/checkpoint por tenant, conexion y recurso;
3. notificacion idempotente;
4. GET del recurso completo;
5. mapper y upsert canonico;
6. reintentos clasificados;
7. reconciliacion periodica;
8. dead-letter y observabilidad.

No asumir orden perfecto, entrega unica ni payload completo. Registrar version de API y fecha de revision de la documentacion.