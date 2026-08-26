# Sync strategy

No confundir capacidades independientes:

- backfill/discovery del provider;
- mapper y upsert idempotente;
- run orchestration, counters y checkpoints;
- resumability con cursor persistente;
- missing reconciliation/lifecycle;
- scheduler/worker;
- webhooks y dead-letter.

Consultar código y `docs/meli-api.md` para saber cuáles están implementadas.
Checkpoint de contadores no implica resumability. No asumir orden perfecto,
entrega única ni payload completo; cada cursor, recovery o reconciliación
requiere diseño y autorización propios.
