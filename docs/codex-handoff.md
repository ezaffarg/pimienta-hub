# Handoff de Codex — e-ngenieria Hub

Este es el punto de entrada para una nueva sesión de agente. Resume el estado sin sustituir el código, los tests, [REGLAS.md](../REGLAS.md) ni [el plan de gobierno](./plan-y-gobierno.md), que conserva la autoridad operativa.

## Producto y estado

e-ngenieria Hub es un SaaS B2B multi-tenant para centralizar la operación de clientes, Stores y cuentas ecommerce desde una plataforma. La relación objetivo es `Organization -> Store -> Connection -> Provider`; Mercado Libre será el primer provider y otros adapters podrán incorporarse después.

**Estado actual:** Fase 0 completada; Fase 1 cerrada; Fase 2 sigue activa en el checkpoint 2.10. La **Database Runtime Validation** local y remota está validada: el proyecto remoto dedicado `ffcudwwrzttkumbdvada` tiene las tres migraciones aplicadas y las fixtures de validación fueron limpiadas. Production no está configurado, RLS permanece diferido y Fase 3 no está iniciada. El working tree debe verificarse antes de trabajar.

Bootstrap First Owner está validado local, remoto y en aplicación: RPC con advisory lock por Organization, Owner cardinality ONE OR MORE y frontera Clerk server-only `org:admin`. El Current Owner ya está persistido en `hub_memberships`, que es la autoridad primaria de roles por Organization y usuario Clerk; el fallback Clerk sigue transitorio y sólo se usa si una consulta exitosa no encuentra membership. Un error DB falla cerrado. Próximo paso: planificación de creación de Stores reales y memberships adicionales antes de retirar ese fallback.

## Arquitectura vigente

- **IMPLEMENTADO:** Clerk resuelve sesión e Organization en servidor. Las APIs demo tienen RBAC default-deny, permisos, scope por Organization, validación Zod, contrato de errores y privacidad Sentry. La suite de Fase 1 cerró con 31 tests.
- **DECIDIDO:** `features/` expresa capacidades del producto; `src/integrations/` contiene adapters técnicos reutilizables. Una Store no copia código de un provider. `hub_memberships` será la fuente definitiva server-side de roles e-Hub; Owner y Manager tienen scope implícito de todas las Stores de su Organization, mientras Employee y Client requieren assignments explícitos. Supabase será PostgreSQL, no Supabase Auth. La migración 2.2 versiona `hub_memberships`, `stores` y `store_assignments` con FKs compuestas por Organization; no fue ejecutada. La CLI `2.114.0` es una devDependency exacta. `supabase/config.toml` es configuración local versionada; Docker y cualquier link remoto siguen diferidos.
- **DIFERIDO:** ejecución real de Store/memberships/assignments, RLS aplicado, OAuth funcional, conexiones reales, Mercado Libre funcional, webhooks y sincronización.
- **PROPUESTO:** módulos de ventas, productos, publicaciones, inventario, precios, preguntas, operaciones masivas, notificaciones, reportes, automatizaciones e IA; no son backlog aprobado.
- **OBSERVADO EN REFERENCIA:** MercadoCuentas aporta necesidades funcionales y UX, nunca contratos, APIs, backend ni fuente de datos. Ver [referencia funcional](./mercado-cuentas-functional-reference.md).

No crear `src/application/` ni `src/domain/` por estilo. Solo se justifican ante una responsabilidad real y un beneficio concreto documentado.

## Reglas no negociables

1. Respetar el orden de fases y esperar aprobación explícita antes de ejecutar una subfase.
2. Todo acceso protegido sigue `Authentication -> Authorization -> Tenant resolution -> Validation -> Service -> Repository -> Database`.
3. La autoridad del tenant proviene de Clerk en servidor; el navegador no prueba Organization, rol, permiso ni Store.
4. Nunca exponer secretos, tokens ni credenciales en UI, respuestas, logs o trazas.
5. Organization Scope sigue siendo el límite superior. Store Scope server-only añade `all-stores` para Owner/Manager y assignments explícitos para Employee/Client; un recurso de otra Organization se oculta con `404` y la falta de permiso/scope es `403`.
6. No usar UI, visibilidad de navegación ni mocks demo como boundary de seguridad.

Los detalles normativos están en [REGLAS.md](../REGLAS.md), [seguridad](./meli-security.md) y [multi-tenancy](./meli-multi-tenancy.md).

## Mercado Libre y MercadoCuentas

La integración futura usa exclusivamente una Mercado Libre Developers Application, OAuth server-side y la API oficial. `client_secret`, `access_token` y `refresh_token` son server-only. La documentación oficial se debe revalidar antes de cualquier cambio de OAuth, PKCE, refresh, webhooks, endpoints o límites.

MercadoCuentas es referencia funcional/producto. La investigación incluyó navegador, DevTools, HAR y 86 screenshots relevantes; los nombres de rutas internas históricas solo ayudaron a inferir responsabilidades. No se copian, llaman, documentan con secretos ni se diseñan contratos sobre endpoints privados.

## Siguiente paso y lectura mínima

El checkpoint activo completa la activación de memberships persistentes y su fallback transitorio. No inicia OAuth ni Fase 3. Antes de operar, leer:

1. [Plan y gobierno](./plan-y-gobierno.md).
2. [Workflow de agentes](./agent-workflow.md).
3. [Multi-tenancy](./meli-multi-tenancy.md), [seguridad](./meli-security.md) y [arquitectura](./meli-architecture.md).
4. [Base de datos](./meli-database.md), [prompts de Fase 1](./prompts/phase-01/README.md) y [decisiones 2.0](./prompts/phase-02/2.0-decisions.md).

Para cualquier trabajo de proveedor, leer además [OAuth y API](./meli-mercadolibre-OAuth/API.md), [integración](./meli-integration.md) y la documentación oficial vigente.

## Fuentes de verdad

En caso de contradicción, prevalecen: código y tests vigentes; `REGLAS.md`/`AGENTS.md`; documentos vigentes de arquitectura, seguridad y gobierno; este handoff; historial de prompts; memoria externa; investigación externa. Una contradicción material se reporta como **DECISIÓN PENDIENTE**, no se resuelve por inferencia.

Skills, agentes, Graphify y la memoria de Obsidian son ayudas opcionales. El repositorio Git permanece autosuficiente y es la autoridad técnica.

## Canonical references

- [Plan y gobierno](./plan-y-gobierno.md)
- [Base de datos y migraciones](./meli-database.md)
- [Multi-tenancy y autorización](./meli-multi-tenancy.md)
- [Evidencia de validación runtime](./database-runtime-validation.md)
- [Índice operativo de Fase 2](./prompts/phase-02/README.md)
# Actualización 2.11

El estado pendiente de Fase 2 incluye provisioning persistente controlado y Store assignment preparation. La autoridad sigue siendo el contexto server-side y el repositorio Git; no hay cutover del fallback ni datos reales.
# Checkpoint 2.12

Real provisioning está en planificación y requiere aprobación humana. Current Clerk Admin fue confirmado como Current Real Owner y está aprobado sólo para provisioning futuro; el inventario remoto de memberships, Stores, assignments y connections está vacío. La matriz canónica vive en [docs/provisioning-plan.md](provisioning-plan.md); fallback Clerk sigue TRANSITIONAL y el cutover no está autorizado.

La corrección 2.13 establece `bootstrap_first_owner` como el camino concurrente, idempotente y server-derived para el primer Owner. El Current Owner ya tiene una única membership persistente `Owner`; `provisionMembership()` se reserva para la autoridad persistente ya existente. La idempotencia quedó validada y la ruta temporal fue eliminada. Global fallback continúa TRANSITIONAL.
