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
- Clerk es la fuente de identidad, autenticación, sesión, `userId` y
  Organization activa; su membership técnica no sustituye los roles de
  negocio e-Hub.
- Clerk Organizations representa el tenant.
- `hub_memberships` es la fuente definitiva server-side del business role
  e-Hub: `Owner`, `Manager`, `Employee` y `Client`.
- Supabase se usa únicamente como PostgreSQL/persistencia; Supabase Auth está
  prohibido. `service_role` es server-only y RLS/constraints complementan el
  aislamiento según el modelo vigente.
- Toda operacion server-side valida autenticacion, autorizacion y tenant.
- La autorizacion se evalua como `User -> Role -> Permission -> Resource Scope -> Resource`.
- Owner, Manager, Employee y Client son roles distintos; Employee y Client nunca obtienen acceso global por su rol.
- La aplicación resuelve roles, permisos, Store Scope, ownership y
  asignaciones comerciales server-side; no se infieren desde roles de Clerk.
- El mapping histórico/transicional `org:admin -> Owner` y `org:member -> Employee`
  sólo describe compatibilidad anterior y no es la autoridad vigente.
- Owner y Manager tienen scope de todas las Stores de su Organization.
- Employee y Client sólo tienen scope de las Stores asignadas explícitamente.
- Permission y Store Scope son controles independientes.
- Toda ruta de negocio requiere Organization activa salvo que este definida expresamente como publica o global.
- Todo body, params y query string se valida en runtime antes de usarse.
- Los errores HTTP no exponen secretos, tokens, trazas, SQL, detalles de Clerk ni infraestructura. Un recurso existente fuera de scope devuelve 403 cuando su existencia no deba ocultarse; 404 se usa solo cuando la politica del recurso exija ocultarla.
- Toda entidad de negocio tiene aislamiento por tenant.
- Los datos externos se transforman mediante mappers.
- Las features consumen modelos canonicos, no DTOs de proveedor.
- Los tokens se almacenan cifrados y server-side.
- Toda conexion pertenece a `Organization -> Store -> External Connection -> Provider`.
- Los errores de proveedores se normalizan y no filtran secretos.
- La UI productiva debe usar endpoints internos protegidos. Los servicios demo que todavía consumen mocks directamente no son un boundary de seguridad ni una prueba de aislamiento; su migración a APIs/persistencia queda diferida a fases posteriores.
- Los cambios conservan la capacidad de actualizar desde `upstream`.

## Flujo requerido

`Request -> Authentication -> Authorization -> Tenant resolution -> Validation -> Service -> Repository -> Database`

## Mercado Libre

- Usar exclusivamente la aplicación propia de Mercado Libre Developers y sus
  APIs oficiales.
- Ejecutar OAuth Authorization Code y refresh únicamente server-side.
- Almacenar tokens y secretos cifrados; nunca exponerlos al navegador, logs o
  respuestas.
- Resolver la identidad mediante la API oficial y respetar siempre los límites
  Organization -> Store -> Connection -> Provider.
- No usar backends privados, cookies de sesión de terceros ni scraping.
- Las escrituras hacia Mercado Libre requieren autorización explícita de la
  subfase correspondiente.
- Normalizar errores del provider sin filtrar material sensible.

## Minimal Diff / No Churn

Todo cambio debe producir el diff semántico mínimo necesario.

### Obligatorio

- Modificar únicamente las líneas necesarias para cumplir el objetivo aprobado.
- Preservar líneas no relacionadas sin reescribirlas.
- Preferir patches quirúrgicos sobre regeneración de archivos.
- Preservar EOL, whitespace, indentación y wrapping existentes fuera de las
  líneas realmente modificadas.
- Revisar `git diff` y `git diff --stat` antes del checkpoint.
- Eliminar churn no semántico antes de finalizar.

### Prohibido

- Borrar y volver a escribir líneas idénticas o semánticamente equivalentes sin
  necesidad.
- Reescribir un archivo completo para un cambio local.
- Normalizar CRLF/LF incidentalmente.
- Modificar whitespace, indentación, wrapping o newline final fuera del alcance.
- Reordenar listas, imports, propiedades o bloques sin necesidad funcional o
  documental.
- Ejecutar formatters o cleanup globales como efecto lateral de una tarea acotada.
- Tocar archivos o bloques no relacionados sólo por consistencia estética.
- Aceptar churn producido por una herramienta si puede reducirse sin perder el
  cambio semántico.

Una línea eliminada y agregada con contenido semánticamente idéntico se considera
un defecto, salvo razón técnica explícita y documentada. Si una herramienta
genera churn, detener la edición, identificar si proviene de EOL, formatter,
wrapping, regeneración o reemplazo amplio, eliminar el ruido y conservar sólo el
cambio semántico mínimo. Minimal Diff no permite sacrificar claridad o seguridad.
