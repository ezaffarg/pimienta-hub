# Roadmap de módulos de producto

Este documento organiza capacidades de producto; no autoriza implementación. La secuencia ejecutable y las puertas de aprobación viven en [plan-y-gobierno.md](./plan-y-gobierno.md).

## Estados

- **Implementado:** existe y está validado en el repositorio.
- **Decidido:** límite o dirección acordada, sin capacidad funcional completa.
- **Propuesto:** posibilidad de producto que requiere priorización y aprobación.
- **Observado:** necesidad vista en la referencia MercadoCuentas; no es compromiso.

| Módulo/capacidad | Estado | Notas |
| --- | --- | --- |
| Seguridad server-side | Implementado | Clerk, Organization, RBAC, permisos, scope por Organization, Zod, HTTP y Sentry. |
| Store, Connections y cuentas externas | Decidido | Próximo bloque de Fase 2; aún no existe persistencia funcional. |
| OAuth de Mercado Libre | Decidido | Fase 3; server-side, una vez exista la base de conexiones. |
| Integraciones de providers | Decidido | Adapter reutilizable por provider en `src/integrations/`; no por Store. |
| Dashboard operacional multi-Store | Propuesto | Ventas, alertas, preguntas, visitas, métricas y pendientes. |
| Sales, compradores y facturación | Propuesto | Mantener facturación separable del núcleo de ventas. |
| Products, listings, inventory y pricing | Propuesto | Evitar identificar publicación de provider con Product canónico. |
| Questions, mensajes y automatizaciones | Propuesto | Capabilities del provider detrás de modelos propios. |
| Bulk operations / imports | Propuesto | Validación, preview, errores por fila y trazabilidad. |
| Envíos, picking y FLEX | Propuesto | Verificar API oficial disponible antes de diseñar. |
| Competition / market intelligence | Observado | No pertenece a Fase 2. |
| IA asistiva | Propuesto | Sugerencias y análisis; nunca autoridad automática en operaciones sensibles. |
| Notificaciones | Propuesto | Provider de delivery separado (email, Telegram, WhatsApp autorizado, interna). |
| Sincronización y webhooks | Decidido | Fase 6: jobs idempotentes, reconciliación y manejo de reintentos. |
| Multicanal (Tiendanube, Shopify, WooCommerce) | Propuesto | Adapters independientes, no detalles de Mercado Libre en features. |

## Dependencias de alto nivel

`Security baseline -> Store/persistencia/connections -> OAuth -> UI de conexiones -> adapter/capacidad inicial -> sincronización -> producto/producción`.

Cada flecha representa una puerta de fase, no permiso automático para avanzar.
