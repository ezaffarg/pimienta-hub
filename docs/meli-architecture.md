# Arquitectura Mercado Libre

## Alcance

Mercado Libre es el primer adapter de un Hub SaaS multi-tenant. Clerk autentica al usuario; Clerk Organization define el tenant; Supabase aporta PostgreSQL.

```text
Usuario -> Clerk -> Organization/Tenant -> Store -> External Connection -> MercadoLibreAdapter -> API de Mercado Libre
```

La integracion vive en `src/integrations/`. Las features consumen modelos canonicos y no conocen DTOs de Mercado Libre.

## Límites de capas confirmados

- `features/` contiene capacidades y experiencias del producto; permanece desacoplado de proveedores externos.
- `integrations/` contiene adapters técnicos hacia sistemas externos. Existe una única implementación reutilizable por proveedor, por ejemplo `src/integrations/mercado-libre/`; una Store nunca contiene una copia del código de Mercado Libre.
- Una Store es una entidad de negocio que en el futuro tendrá conexiones/configuración persistidas: `Organization -> Store -> IntegrationConnection -> Provider`. La conexión conserva referencias y credenciales seguras; el código del provider permanece una sola vez en `integrations/`.
- `src/application/` solo se introducirá cuando existan casos de uso compartidos reales que no correspondan a una feature. `src/domain/` solo se introducirá cuando existan modelos propios de negocio que justifiquen esa frontera. No crear carpetas vacías ni anticipatorias.

Los tipos canónicos de `src/integrations/core/` permanecen allí temporalmente. Antes de implementar adapters reales de ventas, productos, inventario u órdenes se revisará si deben moverse a un dominio o puertos propios.

## Contrato

`EcommerceIntegration` debe ser agnostico al proveedor y expresar capacidades opcionales. El primer hito solo implementa conexion OAuth; la lectura y las mutaciones son fases posteriores.

## Límite

No modificar componentes base ni migrar mocks innecesariamente. Mantener cambios de dominio pequeños para conservar actualizaciones del upstream.

La integración funcional futura de Mercado Libre usará una Mercado Libre Developers Application, OAuth server-side y la API oficial. Sus credenciales técnicas (`client_id`, `client_secret`, `redirect_uri`) pertenecen al servidor, y cada cuenta vendedora autorizará la aplicación mediante OAuth. Nunca se expondrán `access_token`, `refresh_token` ni `client_secret` al navegador.

MercadoCuentas es únicamente una referencia funcional o de producto: no es proveedor de datos, API, dependencia, backend ni integración. No se consumen ni copian endpoints privados; cualquier capacidad inspirada en ella se implementará con la API oficial de Mercado Libre, datos propios del e-Hub y cálculos propios según corresponda.
