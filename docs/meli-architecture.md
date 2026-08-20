# Arquitectura Mercado Libre

## Alcance

Mercado Libre es el primer adapter de un Hub SaaS multi-tenant. Clerk autentica al usuario; Clerk Organization define el tenant; Supabase aporta PostgreSQL.

```text
Usuario -> Clerk -> Organization/Tenant -> Store -> External Connection -> MercadoLibreAdapter -> API de Mercado Libre
```

La integracion vive en `src/integrations/`. Las features consumen modelos canonicos y no conocen DTOs de Mercado Libre.

## Contrato

`EcommerceIntegration` debe ser agnostico al proveedor y expresar capacidades opcionales. El primer hito solo implementa conexion OAuth; la lectura y las mutaciones son fases posteriores.

## Limite

No modificar componentes base ni migrar mocks innecesariamente. Mantener cambios de dominio pequenos para conservar actualizaciones del upstream.