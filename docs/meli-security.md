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
