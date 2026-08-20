# Seguridad Mercado Libre

- Clerk es la identidad; Mercado Libre OAuth es una autorizacion externa distinta.
- OAuth y el cliente HTTP son server-only.
- Nunca enviar tokens al navegador ni guardarlos en storage web.
- Cifrar access/refresh tokens en reposo y evitar que aparezcan en logs, Sentry, HTML o errores.
- Derivar tenant de Clerk; ignorar o rechazar `orgId` del request.
- Validar usuario, organizacion, store y conexion antes de cualquier operacion.
- Redactar PII de compradores y direcciones; almacenar solo lo necesario.
- Validar y normalizar errores externos.
- Verificar state, replay, redirect URI exacta y configuracion vigente de PKCE antes de implementar OAuth.
- No usar Supabase service role desde el cliente.

La autorizacion real ocurre en route handlers/servicios server-side; la navegacion solo mejora UX.