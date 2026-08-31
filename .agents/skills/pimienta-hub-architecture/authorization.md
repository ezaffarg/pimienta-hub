# Authorization

La visibilidad de navegacion es UX. La autorizacion real ocurre en servidor.

## Flujo

1. Validar sesion Clerk.
2. Resolver Organization activa desde Clerk.
3. Resolver la membership y business role desde `hub_memberships`.
4. Resolver Permission y Store Scope de forma independiente.
5. Resolver el recurso dentro de Organization y scope.
6. Autorizar la operacion y solo despues acceder a conexion o recurso externo.

El modelo es `User -> Role -> Permission -> Resource Scope -> Resource`. Clerk aporta identidad, autenticacion y Organization tecnica; `hub_memberships` aporta Owner, Manager, Employee o Client. Owner y Manager tienen todas las Stores de su Organization; Employee y Client solo assignments explicitos. Nunca aceptar `orgId`, `organizationId`, `clientId`, `storeId`, `teamId` o connection id como autoridad del cliente. El request puede aportar un identificador, pero el repositorio debe cruzarlo con tenant, permiso y scope resueltos.

Cuando se conoce un recurso existente pero el usuario carece de scope, devolver 403. Usar 404 solo si la politica del recurso exige ocultar su existencia. Los resolvers y repositories persistentes deben fallar cerrado ante errores o bindings inconsistentes.

## Principio

Ocultar un boton no impide llamar el endpoint. Todo endpoint mutante debe repetir autenticacion, autorizacion y tenant isolation.
