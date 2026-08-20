# OAuth

Para Mercado Libre usar Authorization Code server-side. Antes de implementar se debe revisar la documentacion oficial vigente y la configuracion real de la aplicacion para confirmar si PKCE es requerido u opcional.

## Reglas

- Registrar una redirect URI exacta, estatica y coincidente con Mercado Libre.
- Generar `state` criptograficamente aleatorio, ligado a usuario/tenant/store, con expiracion y consumo unico.
- Validar `state`, `code`, errores OAuth y replay en callback.
- Intercambiar el code server-side mediante body `application/x-www-form-urlencoded` cuando la documentacion vigente lo indique.
- Guardar access y refresh tokens cifrados; nunca devolverlos al navegador.
- El refresh token de Mercado Libre es rotativo y de uso unico segun la documentacion consultada; actualizarlo atomically.
- Distinguir token expirado, grant revocado, configuracion invalida y error temporal.

No codificar PKCE, scopes o URLs basandose en memoria: registrar la fuente oficial y fecha de verificacion.