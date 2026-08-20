# Reglas de arquitectura y seguridad

Estas reglas son obligatorias para cualquier cambio de e-ngenieria Hub.

## Prohibido

- Los componentes UI nunca acceden directamente a Mercado Libre.
- No realizar `fetch()` a APIs externas desde Client Components.
- No almacenar access tokens o refresh tokens en el cliente.
- No guardar credenciales en `localStorage` o `sessionStorage`.
- No confiar en `orgId` u `organizationId` enviado por el navegador.
- No usar Supabase Auth.
- No usar Supabase service role desde el navegador.
- No permitir acceso cross-tenant.
- No usar el ocultamiento de botones como autorizacion.
- No crear una integracion especifica dentro de un feature de negocio.
- No importar DTOs de Mercado Libre en features o dominio.
- No colocar secretos en el repositorio, logs o respuestas.
- No asumir OAuth, PKCE, refresh, webhooks o rate limits sin revisar documentacion oficial vigente.

## Obligatorio

- Todas las integraciones externas viven en `src/integrations/`.
- Clerk es la unica identidad y autenticacion.
- Clerk Organizations representa el tenant.
- Toda operacion server-side valida autenticacion, autorizacion y tenant.
- Toda entidad de negocio tiene aislamiento por tenant.
- Los datos externos se transforman mediante mappers.
- Las features consumen modelos canonicos, no DTOs de proveedor.
- Los tokens se almacenan cifrados y server-side.
- Toda conexion pertenece a `Organization -> Store -> External Connection -> Provider`.
- Los errores de proveedores se normalizan y no filtran secretos.
- La UI solo usa endpoints internos protegidos.
- Los cambios conservan la capacidad de actualizar desde `upstream`.

## Flujo requerido

`Request -> Authentication -> Authorization -> Tenant resolution -> Validation -> Service -> Repository -> Database`

## Primer hito Mercado Libre

Solo conectar cuentas: pantalla, OAuth server-side, state, callback, persistencia segura, desconexion, reautorizacion y estados. Items, inventario, ordenes, preguntas, envios, publicaciones, webhooks completos y otros proveedores quedan fuera.