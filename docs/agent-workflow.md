# Workflow de agentes

## Principio

El repositorio Git es la fuente de verdad técnica. Skills, agentes externos, Graphify y una memoria Obsidian pueden acelerar el análisis, pero no sustituyen documentación, código, tests ni decisiones aprobadas dentro del repositorio.

## Flujo obligatorio por subfase

1. Leer [el handoff](./codex-handoff.md), [el plan](./plan-y-gobierno.md), `AGENTS.md`, `REGLAS.md` y los documentos aplicables.
2. Auditar el estado Git y el código que controla el comportamiento real.
3. Distinguir **DECISIÓN CONFIRMADA**, **SUPOSICIÓN** y **DECISIÓN PENDIENTE**. No convertir una suposición en arquitectura, datos, contratos ni UX.
4. Proponer el alcance mínimo: archivos, dependencias, riesgos, alternativas, coste y estimación de contexto. En cambios de alto impacto, detallar también acciones irreversibles y servicios externos.
5. Detenerse hasta recibir aprobación explícita para la subfase concreta.
6. Implementar solo lo aprobado; añadir o actualizar pruebas correspondientes.
7. Ejecutar `bun run test`, `bun run typecheck`, `bun run lint`, `bun run build` y `git diff --check`, salvo excepción documental aprobada y registrada.
8. Revisar el diff, actualizar la documentación y entregar un checkpoint con hechos, pendientes y warnings.
9. Detenerse. Solo hacer `git add`, commit o push con autorización explícita posterior.

Los commits deben ser pequeños, temáticos y auditables. Cuando exista trabajo fuera de alcance, usar staging explícito por archivo; no usar `git add .` ni `git add -A`.

## Seguridad y fases

Ninguna fase comienza automáticamente. Toda operación futura debe preservar autenticación, Organization, permiso y scope en servidor. Los datos provenientes del navegador —incluidos IDs, roles y permisos— no son autoridad.

La Fase 1 está cerrada. Fase 2, OAuth, providers, persistencia y UI de conexiones requieren aprobaciones nuevas. Las herramientas no habilitan esas fases por sí mismas.

## Herramientas de apoyo

- **Skills/agentes:** aplicar solo cuando estén disponibles y sean pertinentes; las reglas específicas del proyecto prevalecen desde el repositorio.
- **Graphify:** puede analizar relaciones de código y documentos; no reemplaza una decisión arquitectónica ni debe introducir una dependencia funcional.
- **Obsidian:** memoria transversal opcional entre sesiones. Nunca es fuente única de verdad y no recibe secretos, tokens ni credenciales automáticamente.

Si una herramienta no está disponible, el agente debe continuar con la documentación y el repositorio locales.
