# Arquitectura Mercado Libre

Mercado Libre es el primer provider de e-ngenieria Hub. Esta documentación
define invariantes y separa capacidades implementadas de trabajo futuro. El
estado operativo actual se resume en [codex-handoff.md](./codex-handoff.md).

## Modelo y tenant boundary

```text
Usuario
  -> Clerk session
  -> Organization
    -> Store
      -> Connection
        -> MercadoLibreAdapter
          -> API oficial de Mercado Libre
```

- Clerk resuelve identidad, sesión y Organization activa en servidor.
- `hub_memberships` aporta el business role; Permission y Store Scope se
  validan antes de resolver una Connection.
- Organization, Store y Connection se cruzan siempre mediante bindings
  tenant-scoped. IDs del browser sólo identifican objetivos y nunca autorizan.
- La identidad externa se obtiene y verifica mediante la API oficial.

## Límites de capas

- `src/features/` contiene lógica y UI de producto provider-agnostic.
- `src/integrations/` contiene adapters, clients, DTOs, mappers, credenciales y
  servicios de providers externos.
- `src/infrastructure/` contiene repositories, DB e infraestructura técnica.

Los DTOs y errores de Mercado Libre no cruzan a features. Los mappers producen
contratos internos; una Store guarda relaciones y configuración, no una copia
del código del provider.

No se crean `src/application/` o `src/domain/` por estilo. Sólo se extraen
responsabilidades reales cuando aportan un boundary claro y documentado.

## Seguridad de integración

- OAuth Authorization Code, refresh y llamadas autenticadas ocurren server-side.
- `client_id`, `client_secret`, access token y refresh token no llegan al
  navegador, logs, respuestas ni documentación.
- Los tokens se almacenan cifrados y separados de metadata de Connection.
- Refresh usa lease, versionado y compare-and-swap para impedir writers stale.
- Pending authorizations expiran, se consumen una vez y quedan tenant/actor-bound.
- Reconnect usa un `target_connection_id` resuelto y validado server-side.
- La UI sólo consume endpoints internos protegidos.
- Errores externos se normalizan y se redacta material sensible.
- Se usan exclusivamente la aplicación propia de Mercado Libre Developers y
  las APIs oficiales; no scraping, cookies de terceros ni backends privados.

La documentación oficial vigente debe revalidarse antes de cambiar OAuth,
refresh, endpoints, PKCE, rate limits o writes al provider.

## Capacidades implementadas

- OAuth server-side, state de un solo uso y staging de pending authorization.
- Onboarding y finalización atómica tenant-bound.
- Credenciales cifradas, auditoría y safe refresh con lease/version/CAS.
- Reconnect real target-bound reutilizando Store y Connection.
- Identidad oficial de la cuenta externa.
- Listings read-only mediante discovery oficial y multiget/detail.
- Normalización provider-agnostic y persistencia idempotente por Connection.
- Backfill con paginación/scan, chunks máximos de 20, timeout, retry acotado,
  fallos parciales sanitizados y timestamps del provider.
- Sync-run orchestration persistente con start/checkpoint/finalize, audits,
  idempotency y single-running por Connection/kind.

2.20T está cerrado: la infraestructura DB/RPC, la orchestration y la
observabilidad persistente están implementadas y validadas. El run real final
terminó `succeeded`, sin runs activos ni duplicados. Ver [API](./meli-api.md) y
[base de datos](./meli-database.md) para el contrato exacto.

## Capacidades futuras o diferidas

- missing reconciliation y lifecycle/soft-delete;
- scheduler/worker y ejecución periódica;
- stale-run recovery administrativa;
- resumability con cursor persistente;
- webhooks;
- writes hacia Mercado Libre, sólo con autorización explícita;
- variaciones, inventario, órdenes, preguntas, envíos y otros dominios;
- otros providers.

Checkpoint persistente no significa resumability: el run actual conserva
contadores y timestamps, pero no offset, cursor ni `scroll_id`.

## Contratos y referencias

`EcommerceIntegration` y los contratos de `src/integrations/core/` deben seguir
siendo agnósticos al provider y expresar capacidades opcionales. No se obliga a
todos los providers a soportar los mismos recursos.

- [REGLAS.md](../REGLAS.md)
- [Plan y gobierno](./plan-y-gobierno.md)
- [Seguridad](./meli-security.md)
- [Multi-tenancy](./meli-multi-tenancy.md)
- [API](./meli-api.md)
- [Base de datos](./meli-database.md)
- [OAuth](./meli-mercadolibre-OAuth/API.md)

MercadoCuentas es sólo referencia funcional/producto. No es proveedor de datos,
API, dependencia ni backend de e-Hub.
