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
- No reducir Client, Store, Team, asignaciones u ownership a roles de Clerk.
- No confiar en IDs de Organization, Client, Store o Team enviados por el cliente sin comprobar tenant, permiso y scope en servidor.
- No crear una integracion especifica dentro de un feature de negocio.
- No importar DTOs de Mercado Libre en features o dominio.
- No colocar secretos en el repositorio, logs o respuestas.
- No asumir OAuth, PKCE, refresh, webhooks o rate limits sin revisar documentacion oficial vigente.

## Obligatorio

- Todas las integraciones externas viven en `src/integrations/`.
- Clerk es la unica identidad y autenticacion.
- Clerk Organizations representa el tenant.
- Toda operacion server-side valida autenticacion, autorizacion y tenant.
- La autorizacion se evalua como `User -> Role -> Permission -> Resource Scope -> Resource`.
- Owner, Manager, Employee y Client son roles distintos; Employee y Client nunca obtienen acceso global por su rol.
- Clerk resuelve identidad, autenticacion, Organization y roles/permisos base; la aplicacion resuelve el alcance comercial de Client, Store, Team, ownership y asignaciones.
- Mientras no exista una fuente propia de roles, el mapping provisional server-side es `org:admin -> Owner` y `org:member -> Employee`; cualquier otro rol de Clerk se deniega. Manager y Client no se infieren desde Clerk.
- Toda ruta de negocio requiere Organization activa salvo que este definida expresamente como publica o global.
- Todo body, params y query string se valida en runtime antes de usarse.
- Los errores HTTP no exponen secretos, tokens, trazas, SQL, detalles de Clerk ni infraestructura. Un recurso existente fuera de scope devuelve 403 cuando su existencia no deba ocultarse; 404 se usa solo cuando la politica del recurso exija ocultarla.
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
