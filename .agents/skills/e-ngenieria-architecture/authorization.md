# Authorization

La visibilidad de navegacion es UX. La autorizacion real ocurre en servidor.

## Flujo

1. Validar sesion Clerk.
2. Validar permiso/rol para administrar integraciones.
3. Resolver `orgId` desde Clerk.
4. Resolver Store perteneciente a esa organizacion.
5. Resolver la conexion externa perteneciente a Store.
6. Validar el recurso externo antes de operar.

Nunca aceptar `orgId`, `organizationId`, `storeId` o connection id como autoridad del cliente. El request puede aportar un identificador, pero el repositorio debe cruzarlo con el tenant resuelto y devolver 404/403 sin revelar datos.

## Principio

Ocultar un boton no impide llamar el endpoint. Todo endpoint mutante debe repetir autenticacion, autorizacion y tenant isolation.