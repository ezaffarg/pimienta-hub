# Workflow de agentes

## Principio

El repositorio Git es la fuente de verdad técnica. Skills, agentes externos, Graphify y una memoria Obsidian pueden acelerar el análisis, pero no sustituyen documentación, código, tests ni decisiones aprobadas dentro del repositorio.

Los prompts archivados son historial operativo y deben enlazar a documentos canónicos relevantes en vez de duplicarlos. Obsidian es índice y memoria resumida: resume y enlaza al repositorio, nunca copia prompts, SQL, tests, logs o documentación canónica completa. Esta convención se aplica retrospectivamente al índice/documentación de Fase 2 sin reescribir el contenido histórico de los prompts.

## Flujo obligatorio por subfase

1. Leer [el handoff](./codex-handoff.md), [el plan](./plan-y-gobierno.md), `AGENTS.md`, `REGLAS.md` y los documentos aplicables.
2. Archivar el mandato operativo en `docs/prompts/` antes de la primera acción; no depender solo de conversación. Si hay bloqueo, conservarlo y actualizar su resultado.
3. Auditar el estado Git y el código que controla el comportamiento real.
4. Distinguir **DECISIÓN CONFIRMADA**, **SUPOSICIÓN** y **DECISIÓN PENDIENTE**. No convertir una suposición en arquitectura, datos, contratos ni UX.
5. Proponer el alcance mínimo: archivos, dependencias, riesgos, alternativas, coste y estimación de contexto. En cambios de alto impacto, detallar también acciones irreversibles y servicios externos.
6. Detenerse hasta recibir aprobación explícita para la subfase concreta.
7. Implementar solo lo aprobado; añadir o actualizar pruebas correspondientes.
8. Ejecutar `bun run test`, `bun run typecheck`, `bun run lint`, `bun run build` y `git diff --check`, salvo excepción documental aprobada y registrada.
9. Revisar el diff, actualizar la documentación y entregar un checkpoint con hechos, pendientes y warnings.
10. Detenerse. Solo hacer `git add`, commit o push con autorización explícita posterior.

Los commits deben ser pequeños, temáticos y auditables. Cuando exista trabajo fuera de alcance, usar staging explícito por archivo; no usar `git add .` ni `git add -A`.

## Aprobaciones rutinarias preautorizadas

Los prompts operativos pueden preautorizar acciones rutinarias dentro del workspace. El agente no debe solicitar confirmación repetida para acciones explícitamente autorizadas por el mandato. Operaciones sensibles, destructivas, globales, remotas o fuera de scope continúan requiriendo aprobación.

## Seguridad y fases

Ninguna fase comienza automáticamente. Toda operación futura debe preservar autenticación, Organization, permiso y scope en servidor. Los datos provenientes del navegador —incluidos IDs, roles y permisos— no son autoridad.

La Fase 1 está cerrada. Fase 2, OAuth, providers, persistencia y UI de conexiones requieren aprobaciones nuevas. Las herramientas no habilitan esas fases por sí mismas.

## Herramientas de apoyo

- **Skills/agentes:** aplicar solo cuando estén disponibles y sean pertinentes; las reglas específicas del proyecto prevalecen desde el repositorio.
- **Graphify:** puede analizar relaciones de código y documentos; no reemplaza una decisión arquitectónica ni debe introducir una dependencia funcional.
- **Obsidian:** memoria transversal opcional entre sesiones. Nunca es fuente única de verdad y no recibe secretos, tokens ni credenciales automáticamente.

Si una herramienta no está disponible, el agente debe continuar con la documentación y el repositorio locales.
