# Seguridad Mercado Libre

- Clerk es la identidad; Mercado Libre OAuth es una autorizacion externa distinta.
- OAuth y el cliente HTTP son server-only.
- Nunca enviar tokens al navegador ni guardarlos en storage web.
- Cifrar access/refresh tokens en reposo y evitar que aparezcan en logs, Sentry, HTML o errores.
- Derivar tenant de Clerk; ignorar o rechazar `orgId` del request como autoridad.
- Tratar `clientId`, `storeId`, `teamId` y cualquier identificador del request como no confiable hasta comprobar tenant, permiso y scope.
- Validar usuario, organizacion, rol, permiso, Client, Store, Team, conexion y recurso antes de cualquier operacion.
- Redactar PII de compradores y direcciones; almacenar solo lo necesario.
- Validar y normalizar errores externos.
- Verificar state, replay, redirect URI exacta y configuracion vigente de PKCE antes de implementar OAuth.
- No usar Supabase service role desde el cliente.

La autorizacion real ocurre en route handlers/servicios server-side; la navegacion solo mejora UX. El orden conceptual es `User -> Role -> Permission -> Resource Scope -> Resource`. Una Store existente fuera de alcance devuelve 403 en los escenarios de seguridad explícitos; 404 puede usarse solo cuando la política del recurso requiera ocultar su existencia.

## Subfase 1.2 — Contexto server-side

`requireServerTenantContext()` obtiene exclusivamente de `auth()` de Clerk el `userId` y la Organization activa. No recibe ni acepta identidad, tenant, roles o permisos desde body, query, headers o estado del navegador.

Los Route Handlers de `/api/products` y `/api/users` usan `withServerTenantContext()` antes de acceder a datos o procesar body y parámetros. El error uniforme es `{ error: { code, message } }`: ausencia de sesión devuelve `401 AUTHENTICATION_REQUIRED`; una sesión sin Organization activa devuelve `403 ORGANIZATION_REQUIRED`, porque la identidad es válida pero no está autorizada para operar sobre un tenant. RBAC, permisos y scope siguen fuera de esta subfase.

## Subfase 1.3A — RBAC base

Clerk continúa resolviendo la sesión, Organization y membership en servidor; e-Hub controla los roles de negocio y sus permisos. El mapping temporal es `org:admin -> Owner` y `org:member -> Employee`. Manager y Client son roles aprobados del e-Hub, pero no se resuelven automáticamente desde Clerk hasta que exista una fuente propia aprobada. Un rol Clerk desconocido se deniega por defecto.

La policy inicial usa permisos estables: `products.read`, `products.write`, `users.read` y `users.write`. Owner tiene todos; Manager tiene lectura/escritura de productos y lectura de usuarios; Employee solo lectura de productos; Client no recibe permisos globales antes de Resource Scope. Los handlers validan el permiso en servidor y devuelven `403 AUTHORIZATION_DENIED` cuando no está permitido. Resource Scope, Store y asignaciones siguen fuera de esta subfase.
