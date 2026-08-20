# Authorization

La visibilidad de navegacion es UX. La autorizacion real ocurre en servidor.

## Flujo

1. Validar sesion Clerk.
2. Resolver Organization activa desde Clerk.
3. Resolver User, Role y Permission.
4. Resolver Resource Scope de dominio para Client, Store, Team y asignaciones.
5. Resolver el recurso dentro de Organization y scope.
6. Autorizar la operacion y solo despues acceder a conexion o recurso externo.

El modelo es `User -> Role -> Permission -> Resource Scope -> Resource`. Clerk aporta identidad, autenticacion, Organization y roles/permisos base; la aplicacion conserva Client, Store, Team, ownership y asignaciones. Nunca aceptar `orgId`, `organizationId`, `clientId`, `storeId`, `teamId` o connection id como autoridad del cliente. El request puede aportar un identificador, pero el repositorio debe cruzarlo con tenant, permiso y scope resueltos.

Cuando se conoce un recurso existente pero el usuario carece de scope, devolver 403. Usar 404 solo si la politica del recurso exige ocultar su existencia. Antes de la persistencia de Fase 2, los guards consumen un contrato de resolver temporal testeable, reemplazable luego por un resolver persistente sin cambiar los guards.

## Principio

Ocultar un boton no impide llamar el endpoint. Todo endpoint mutante debe repetir autenticacion, autorizacion y tenant isolation.
