# Integracion Mercado Libre

## Primer hito

1. El usuario autenticado selecciona una Store de su Organization.
2. El servidor valida Clerk, permiso y ownership.
3. El servidor genera state y redirige a Mercado Libre.
4. El callback valida state, code, error y redirect URI.
5. El servidor intercambia el code y consulta la cuenta autorizada.
6. Se persisten cuenta, scopes, expiracion y credenciales cifradas.
7. La UI muestra conectado, expirado, requiere autorizacion o error.

Desconexion invalida la conexion local y limpia credenciales. Reautorizacion inicia un nuevo flujo y nunca mezcla tenants o cuentas.

La configuracion de app, URLs y PKCE se verifica contra la documentacion oficial vigente antes de codificar.