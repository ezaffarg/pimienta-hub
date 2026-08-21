# Handoff de Codex — e-ngenieria Hub

Este es el punto de entrada para una nueva sesión de agente. Resume el estado sin sustituir el código, los tests, [REGLAS.md](../REGLAS.md) ni [el plan de gobierno](./plan-y-gobierno.md), que conserva la autoridad operativa.

## Producto y estado

e-ngenieria Hub es un SaaS B2B multi-tenant para centralizar la operación de clientes, Stores y cuentas ecommerce desde una plataforma. La relación objetivo es `Organization -> Store -> Connection -> Provider`; Mercado Libre será el primer provider y otros adapters podrán incorporarse después.

**Estado actual:** Fase 0 completada; Fase 1 cerrada en `b543597`; Fase 2 está en planificación: la auditoría 2.0 y sus decisiones están aprobadas, pero 2.1 todavía no está autorizada. El working tree debe verificarse antes de trabajar.

## Arquitectura vigente

- **IMPLEMENTADO:** Clerk resuelve sesión e Organization en servidor. Las APIs demo tienen RBAC default-deny, permisos, scope por Organization, validación Zod, contrato de errores y privacidad Sentry. La suite de Fase 1 cerró con 31 tests.
- **DECIDIDO:** `features/` expresa capacidades del producto; `src/integrations/` contiene adapters técnicos reutilizables. Una Store no copia código de un provider. `hub_memberships` será la fuente definitiva server-side de roles e-Hub; Owner y Manager tienen scope implícito de todas las Stores de su Organization, mientras Employee y Client requieren assignments explícitos. Supabase será PostgreSQL, no Supabase Auth.
- **DIFERIDO:** Store, Client/Team, asignaciones, persistencia, repositorios, RLS aplicado, OAuth funcional, conexiones reales, Mercado Libre funcional, webhooks y sincronización.
- **PROPUESTO:** módulos de ventas, productos, publicaciones, inventario, precios, preguntas, operaciones masivas, notificaciones, reportes, automatizaciones e IA; no son backlog aprobado.
- **OBSERVADO EN REFERENCIA:** MercadoCuentas aporta necesidades funcionales y UX, nunca contratos, APIs, backend ni fuente de datos. Ver [referencia funcional](./mercado-cuentas-functional-reference.md).

No crear `src/application/` ni `src/domain/` por estilo. Solo se justifican ante una responsabilidad real y un beneficio concreto documentado.

## Reglas no negociables

1. Respetar el orden de fases y esperar aprobación explícita antes de ejecutar una subfase.
2. Todo acceso protegido sigue `Authentication -> Authorization -> Tenant resolution -> Validation -> Service -> Repository -> Database`.
3. La autoridad del tenant proviene de Clerk en servidor; el navegador no prueba Organization, rol, permiso ni Store.
4. Nunca exponer secretos, tokens ni credenciales en UI, respuestas, logs o trazas.
5. El scope actual es solo Organization. Un recurso de otra Organization se oculta con `404`; la falta de permiso es `403`.
6. No usar UI, visibilidad de navegación ni mocks demo como boundary de seguridad.

Los detalles normativos están en [REGLAS.md](../REGLAS.md), [seguridad](./meli-security.md) y [multi-tenancy](./meli-multi-tenancy.md).

## Mercado Libre y MercadoCuentas

La integración futura usa exclusivamente una Mercado Libre Developers Application, OAuth server-side y la API oficial. `client_secret`, `access_token` y `refresh_token` son server-only. La documentación oficial se debe revalidar antes de cualquier cambio de OAuth, PKCE, refresh, webhooks, endpoints o límites.

MercadoCuentas es referencia funcional/producto. La investigación incluyó navegador, DevTools, HAR y 86 screenshots relevantes; los nombres de rutas internas históricas solo ayudaron a inferir responsabilidades. No se copian, llaman, documentan con secretos ni se diseñan contratos sobre endpoints privados.

## Siguiente paso y lectura mínima

La siguiente subfase candidata es **2.1 — decisiones finales de schema + convención de migraciones**, pero requiere aprobación explícita. Antes de proponerla, leer:

1. [Plan y gobierno](./plan-y-gobierno.md).
2. [Workflow de agentes](./agent-workflow.md).
3. [Multi-tenancy](./meli-multi-tenancy.md), [seguridad](./meli-security.md) y [arquitectura](./meli-architecture.md).
4. [Base de datos](./meli-database.md), [prompts de Fase 1](./prompts/phase-01/README.md) y [decisiones 2.0](./prompts/phase-02/2.0-decisions.md).

Para cualquier trabajo de proveedor, leer además [OAuth y API](./meli-mercadolibre-OAuth/API.md), [integración](./meli-integration.md) y la documentación oficial vigente.

## Fuentes de verdad

En caso de contradicción, prevalecen: código y tests vigentes; `REGLAS.md`/`AGENTS.md`; documentos vigentes de arquitectura, seguridad y gobierno; este handoff; historial de prompts; memoria externa; investigación externa. Una contradicción material se reporta como **DECISIÓN PENDIENTE**, no se resuelve por inferencia.

Skills, agentes, Graphify y la memoria de Obsidian son ayudas opcionales. El repositorio Git permanece autosuficiente y es la autoridad técnica.
