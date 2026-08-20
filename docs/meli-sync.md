# Sincronizacion Mercado Libre

Fuera del primer hito. La estrategia futura sera webhook-first con reconciliacion, backfill, cursores, idempotencia, jobs, reintentos clasificados y dead-letter.

No confiar en entrega unica, orden perfecto ni payload completo. Consultar el recurso indicado, mapear DTO a modelo canonico y persistir por tenant/conexion.

Usar backoff exponencial con jitter ante 429 y revisar la vigencia de `missed_feeds` antes de depender de ese mecanismo.