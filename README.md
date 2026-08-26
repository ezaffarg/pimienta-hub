# e-ngenieria Hub

e-ngenieria Hub es un SaaS/hub operativo multi-tenant para administrar
múltiples Stores y conexiones e-commerce desde una única plataforma. Mercado
Libre es el primer provider implementado; la arquitectura queda preparada para
otros canales.

## Qué es e-ngenieria Hub

El equipo interno gestiona clientes y sus Stores desde un mismo Hub. Cada
cliente sólo accede a las Stores que tiene asignadas. La plataforma integra
cuentas de Mercado Libre y separa identidad, tenant, Store, Connection y
provider para crecer hacia un modelo multicanal.

## Estado actual

- Autenticación y sesión server-side con Clerk, incluyendo Organizations.
- Roles de negocio y Store Scope persistidos y tenant-scoped.
- Persistencia PostgreSQL mediante Supabase; no se usa Supabase Auth.
- Stores y Connections con aislamiento por Organization.
- OAuth de Mercado Libre y credenciales cifradas exclusivamente server-side.
- Listings read-only y persistencia idempotente.
- Sync-run orchestration y observabilidad persistente de listings implementadas
  y validadas.
- El resto de las capacidades e-commerce se incorpora de forma incremental.

## Stack principal

Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui, Clerk, Supabase
PostgreSQL, Zod, TanStack Query/Table/Form, Sentry y Recharts.

Supabase se utiliza como PostgreSQL y capa de persistencia. Supabase Auth no
forma parte de la arquitectura.

## Arquitectura

```text
Clerk                       identity, session, Organization
  -> hub_memberships        business role authority
  -> Organization
       -> Stores
            -> Connections
                 -> Provider
```

Las features consumen modelos provider-agnostic. Los adapters externos viven
en `src/integrations/` y la infraestructura de base de datos vive en
`src/infrastructure/`.

## Seguridad

- Autenticación, autorización y tenant resolution en servidor.
- Aislamiento por Organization, Store y Connection.
- Los IDs enviados por el navegador nunca son autoridad de scope.
- Access tokens, refresh tokens y secretos son server-only y cifrados.
- La UI no llama directamente a providers externos.
- Supabase `service_role` nunca se expone al navegador.
- Los errores se normalizan sin secretos, tokens, headers ni trazas internas.

Las invariantes completas están en [REGLAS.md](./REGLAS.md).

## Mercado Libre

La integración usa una aplicación propia de Mercado Libre Developers y el flujo
OAuth Authorization Code server-side. Las credenciales se refrescan mediante
lease, versionado y CAS seguros; la identidad proviene de la API oficial. Las
Stores y Connections existentes se reutilizan cuando corresponde. El listing
sync actual es read-only hacia Mercado Libre; cualquier escritura al provider
requiere autorización explícita de su subfase.

## Desarrollo local

Requisitos principales: Bun, variables de entorno locales y, para validaciones
de PostgreSQL/Supabase local, Docker cuando el procedimiento lo requiera.

```bash
bun install
```

Copia `env.example.txt` a `.env.local` y completa las variables requeridas sin
publicar sus valores. Luego inicia el servidor:

```bash
bun run dev
```

La aplicación queda disponible en `http://localhost:3000`. Consulta
[docs/deployment.md](./docs/deployment.md) para despliegues y la documentación
especializada para configuración adicional.

## Estructura documental

- `README.md`: entrada humana al proyecto.
- `AGENTS.md`: instrucciones operativas para agentes.
- `REGLAS.md`: invariantes obligatorias de arquitectura y seguridad.
- `docs/`: Source of Truth técnico.
- `docs/prompts/`: historial operativo de mandatos.

El repositorio es la fuente de verdad; los prompts conservan historial y no
sustituyen la documentación técnica vigente.

## Upstream

El proyecto nació sobre
[Kiranism next-shadcn-dashboard-starter](https://github.com/Kiranism/next-shadcn-dashboard-starter).
`README_OLD.md` conserva la documentación histórica de ese starter y no
describe el producto actual.
