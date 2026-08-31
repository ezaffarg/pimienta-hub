# Authentication

Clerk es la unica identidad del Hub. La sesion del usuario del Hub y la autorizacion otorgada por una cuenta de Mercado Libre son credenciales distintas.

## Reglas

- Usar `auth()` desde codigo server-side para obtener `userId` y `orgId`.
- `auth.protect()` en middleware protege UX, pero cada handler y servicio debe validar su propio acceso.
- Clerk Organizations representa la empresa/tenant activo.
- La membership tecnica de Clerk Organization no reemplaza el business role de
  `hub_memberships` ni el Store Scope de Pimienta Hub.
- Mercado Libre OAuth solo autoriza el acceso de una cuenta externa a la aplicacion.
- Un colaborador de Mercado Libre no debe asumirse equivalente al administrador de la cuenta; validar la documentacion vigente y los errores de grant.
- No usar Supabase Auth.

## Boundary

```text
Browser -> Clerk session -> protected internal route -> Mercado Libre OAuth/API
```

La UI nunca recibe ni administra credenciales de Mercado Libre.
