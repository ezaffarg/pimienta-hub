# Mercado Libre OAuth y API

Documento operativo. Revisar y actualizar antes de cada implementacion de OAuth o cambio de endpoint.

## OAuth verificado el 2026-08-19

- Authorization Code server-side.
- `state` criptografico, ligado al intento y de un solo uso.
- La redirect URI debe usar HTTPS y ser estatica, exactamente igual a la configurada.
- Los scopes disponibles documentados son `read`, `write` y `offline_access`; pedir el minimo necesario.
- PKCE es opcional en la configuracion de la aplicacion y Mercado Libre recomienda usarlo. Si se habilita, `code_challenge`/`code_verifier` son obligatorios; se recomienda `S256` y no `plain`.
- El code se intercambia server-side mediante body `application/x-www-form-urlencoded`.
- La pagina documenta una validez de 6 horas, pero su ejemplo muestra `expires_in: 10800` segundos. No asumir una constante: persistir y respetar el `expires_in` real recibido, con margen de renovacion configurable, y verificar el comportamiento con usuarios de test.
- El refresh token es de uso unico: cada refresh devuelve uno nuevo y el anterior queda invalido. Actualizarlo atomicamente.
- La cuenta que autoriza debe ser la cuenta principal/administradora; los operadores o colaboradores pueden fallar con `invalid_operator_user_id`.
- Desde el 2026-08-30 las aplicaciones deben separarse entre Mercado Libre y Mercado Pago; no mezclar scopes `urn:mp:*` en la aplicacion de Mercado Libre.

## API

Las llamadas externas deben salir de un cliente server-only, enviar Bearer token por header, usar DTOs tipados y pasar por mappers. Las operaciones de items, ordenes, preguntas, envios, notificaciones, rate limits y errores se implementaran en fases posteriores.

## Fuente

- https://developers.mercadolibre.com.ar/es_ar/api-docs-es
- https://developers.mercadolibre.com.ar/es_ar/autenticacion-y-autorizacion
- https://developers.mercadolibre.com.ar/es_ar/recomendaciones-de-autorizacion-y-token

Registrar fecha de revision, scopes confirmados, URLs por site y cambios/deprecaciones observados. Revalidar esta informacion antes de implementar o cambiar el flujo.