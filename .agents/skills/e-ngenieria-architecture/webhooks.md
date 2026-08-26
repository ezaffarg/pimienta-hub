# Webhooks

Los webhooks permanecen diferidos hasta una subfase explícitamente aprobada.

Cuando se habiliten:

- El callback debe ser publico solo en transporte, con validacion de payload/origen y ruta de `resource`.
- Responder HTTP 200 rapidamente, idealmente dentro de 500 ms.
- Persistir una clave idempotente antes de procesar.
- Encolar el refresco del recurso y no confiar en el payload como estado completo.
- Resolver tenant por application/user/account mapping, nunca por `orgId` del body.
- Manejar duplicados, replay, errores y dead-letter.
- Implementar recuperacion con `missed_feeds` solo si la API vigente la mantiene y documentarlo.
- Redactar PII y secretos de las notificaciones en logs.
