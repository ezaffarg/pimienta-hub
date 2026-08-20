---
name: e-ngenieria-architecture
description: Arquitectura normativa para e-ngenieria Hub: SaaS multi-tenant con Clerk, Clerk Organizations, Supabase PostgreSQL e integraciones ecommerce aisladas. Usar antes de crear rutas, features, servicios, persistencia o integraciones externas.
---

# e-ngenieria Hub Architecture

Esta Skill es la fuente de verdad arquitectonica para agentes que trabajen en e-ngenieria Hub.

## Objetivo

Mantener un SaaS multi-tenant y multicanal donde Mercado Libre sea el primer adapter y Shopify, Tiendanube y WooCommerce puedan agregarse sin modificar el dominio central ni romper el upstream del starter.

## Orden obligatorio

1. Auditar el repositorio y las instrucciones locales.
2. Identificar el codigo que realmente controla el comportamiento.
3. Diseñar el limite de tenant, integracion y persistencia.
4. Revisar la documentacion oficial vigente del proveedor.
5. Documentar decisiones y riesgos.
6. Implementar el cambio minimo.
7. Ejecutar una validacion enfocada y las comprobaciones de seguridad.

No comenzar por codigo de integracion solo porque una llamada HTTP parezca sencilla.

## Fuentes de identidad y datos

- Clerk es la unica fuente de identidad y autenticacion del Hub.
- Clerk Organizations representa el tenant.
- Supabase se usa unicamente como PostgreSQL. No usar Supabase Auth.
- El tenant se resuelve desde Clerk en servidor. Nunca confiar en `orgId`, `organizationId` o `storeId` enviados por el navegador.
- El service role de Supabase es exclusivamente server-side.

## Flujo server-side obligatorio

Toda API protegida debe seguir:

`Request -> Authentication -> Authorization -> Tenant resolution -> Validation -> Service -> Repository -> Database`

Estar dentro de `/api` o dentro del dashboard no equivale a estar autorizado.

## Guardrails no negociables

### Prohibido

- Los componentes UI nunca acceden directamente a Mercado Libre ni a otro proveedor.
- No realizar `fetch()` a APIs externas desde Client Components.
- No exponer access tokens o refresh tokens al navegador.
- No guardar tokens en `localStorage` o `sessionStorage`.
- No confiar en un `orgId` enviado por el navegador.
- No usar Supabase service role desde el navegador.
- No permitir acceso cross-tenant.
- No usar el ocultamiento de botones como mecanismo de autorizacion.
- No crear una integracion especifica dentro de un feature de negocio.
- No importar DTOs de Mercado Libre en el dominio o la UI.
- No colocar secretos en el repositorio, logs, respuestas, HTML, trazas o errores.
- No asumir comportamientos de OAuth, PKCE, refresh tokens, webhooks o rate limits sin verificar la documentacion oficial vigente.
- No migrar mocks, rediseñar el starter o mover archivos sin una necesidad concreta.

### Obligatorio

- Todas las integraciones externas viven en `src/integrations/`.
- Toda entidad de negocio tiene aislamiento por tenant.
- Toda operacion protegida valida Clerk en servidor.
- Toda operacion valida tenant, conexion y recurso antes de acceder a datos.
- Los datos externos se transforman mediante mappers.
- Las features consumen modelos canonicos, no DTOs especificos del proveedor.
- Los tokens se almacenan cifrados y se rotan de forma segura.
- Cada integracion tiene cliente HTTP, errores y servicios propios.
- Las capacidades que no sean comunes se modelan como opcionales o capability flags.
- Toda mutacion tiene validacion de entrada, autorizacion, auditoria y errores normalizados.
- Los cambios deben conservar una frontera clara con el upstream del starter.

## Limite de integraciones

La arquitectura preferida es:

```text
src/integrations/
  core/                       # contrato y modelos canonicos
  mercado-libre/              # primer adapter
    auth/
    client/
    dto/
    mappers/
    services/
    adapter/
  shopify/                    # futuro
  tiendanube/                 # futuro
  woocommerce/                # futuro
```

El repositorio actual usa `src/features/`, por lo que no se deben crear `src/modules/` o `src/infrastructure/` por reflejo. Adaptar la estructura a los limites existentes y mover solo cuando sea necesario.

## Contrato comun

El contrato `EcommerceIntegration` debe ser agnostico al proveedor. Debe contemplar autenticacion, refresh, productos, ordenes, inventario, clientes y webhooks, pero no forzar a todos los proveedores a soportar exactamente las mismas capacidades. Preguntas, envios, publicaciones y operaciones especificas deben expresarse como capacidades opcionales.

```text
Application / Domain
  -> EcommerceIntegration
    -> MercadoLibreAdapter
      -> Mercado Libre API
```

## Primer hito permitido

El primer hito de Mercado Libre solo conecta cuentas:

- pantalla de conexiones;
- inicio y callback OAuth server-side;
- `state` criptografico, expiracion y consumo unico;
- redirect URI exacta;
- verificacion oficial de PKCE antes de implementarlo;
- access/refresh token cifrados y server-side;
- asociacion Organization -> Store -> External Connection;
- desconexion, reautorizacion y estados de conexion.

Quedan fuera del primer hito: sincronizacion completa, items, inventario, ordenes, preguntas, envios, publicaciones, webhooks completos y otros proveedores.

## Validacion requerida

Antes de cerrar un cambio, comprobar:

- que ningun Client Component accede a proveedores externos;
- que una organizacion no puede leer, mutar o desconectar otra;
- que los tokens no aparecen en respuestas, almacenamiento del navegador, logs ni errores;
- que `orgId` del request no controla el tenant;
- que todos los handlers relevantes validan autenticacion y autorizacion server-side;
- que los DTOs externos no cruzan al dominio;
- que `bun run typecheck`, `bun run lint`, `bun run format:check` y `bun run build` pasan cuando el entorno lo permite;
- que el diff sigue siendo pequeno y rebasable sobre `upstream`.

## Referencias

- [authentication.md](authentication.md)
- [authorization.md](authorization.md)
- [multi-tenancy.md](multi-tenancy.md)
- [oauth.md](oauth.md)
- [api-client.md](api-client.md)
- [rate-limits.md](rate-limits.md)
- [webhooks.md](webhooks.md)
- [database.md](database.md)
- [sync-strategy.md](sync-strategy.md)
- [orders.md](orders.md)
- [items.md](items.md)
- [questions.md](questions.md)
- [shipments.md](shipments.md)
