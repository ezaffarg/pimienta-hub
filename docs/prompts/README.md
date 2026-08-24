# Registro de prompts y mandatos significativos

Este registro conserva decisiones, autorizaciones y cierres relevantes sin replicar conversaciones completas. Es evidencia de contexto, no fuente de verdad frente a código, tests, reglas y documentos vigentes.

Cuando el texto literal no quedó guardado en el repositorio, la entrada se marca **Reconstructed from repository decisions** y nunca se presenta como cita literal.

## Índice

- [Fase 1 — cierre de seguridad](./phase-01/README.md)
- [Fase 2 — planificación y decisiones](./phase-02/README.md)

## Norma permanente de referencias

**El repositorio Git es la Source of Truth.** Los documentos canónicos, código y tests versionados prevalecen sobre cualquier memoria o conversación. Obsidian es sólo memoria operativa resumida e índice; los prompts archivados son historial operativo.

Esta convención se adopta en el estado actual y se aplica retrospectivamente al índice y documentación de Fase 2, sin reescribir la historia original de los prompts. No se duplica contenido completo entre prompts, documentos canónicos, handoff u Obsidian: las decisiones técnicas completas viven en su Markdown canónico; los prompts y Obsidian enlazan y resumen. El handoff permanece breve y enlaza a las fuentes canónicas. Los resultados de prompts son resúmenes estructurados, no transcripciones de respuestas de agentes.

## Regla operativa obligatoria

Todo prompt operativo enviado a Codex durante el desarrollo debe archivarse dentro de `docs/prompts/` **antes de la primera acción operativa**. Incluye auditorías, diseño, implementación, decisiones, bloqueos, reintentos, correcciones, validaciones, checkpoints, cierres, commits, pushes y handoffs. Ningún mandato operativo debe depender solo del historial de conversación.

Se archivan mandatos, no conversaciones completas. Si el trabajo se bloquea, el prompt permanece archivado y su `Result` se actualiza con el hecho comprobable.

## Convención

Cada entrada registra estado, propósito, decisión/limitaciones, resultado y commit. Los mandatos reemplazados deben indicar `SUPERSEDED` y enlazar al vigente. El commit que crea un prompt conserva `Commit: PENDING`: su propio hash se informa en el checkpoint y se registra en un mandato o cierre posterior cuando corresponda; no se crea un commit circular solo para insertar el hash en sí mismo.

Los nombres usan una subfase cronológica estable: no se dejan placeholders permanentes como `2.x`. Cuando una etapa requiere más de un mandato, se usa un sufijo (`b`, `c`, `-retry` o `-close`), por ejemplo `2.6-phase-close-readiness.md`, `2.6b-phase-close-commit.md`, `2.7-runtime-db-validation.md` y `2.7b-runtime-db-validation-retry.md`.
