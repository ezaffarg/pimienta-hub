# UI Mercado Libre

La UI inicial sera una pantalla de conexiones dentro del dashboard existente. Reutilizar `PageContainer`, componentes shadcn, TanStack Form/Zod y React Query segun los patrones del starter.

Estados visibles:

- desconectado;
- conectando;
- conectado;
- expirado;
- requiere autorizacion;
- error.

La UI solo llama endpoints internos protegidos por Clerk. No conoce URLs de Mercado Libre, tokens, DTOs externos ni reglas de persistencia. El ocultamiento de acciones es UX y nunca reemplaza la autorizacion server-side.