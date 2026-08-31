# API client

Cada proveedor tiene un cliente HTTP dedicado y server-only. El cliente de Mercado Libre no se importa desde componentes ni desde codigo marcado `use client`.

Debe centralizar:

- Bearer authentication.
- timeouts y abort signals.
- refresh coordinado.
- headers y versiones requeridas por endpoint.
- parseo de DTOs.
- errores normalizados.
- limites de concurrencia, retries y rate limits.
- redaccion de secretos y PII en logs.

Flujo de datos:

```text
Mercado Libre DTO -> mapper -> modelo canonico de Pimienta Hub
```

No usar `src/lib/api-client.ts` para llamar directamente a Mercado Libre; es solo referencia del BFF interno actual.