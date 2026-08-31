# Rate limits

Mercado Libre puede responder `429 Too Many Requests`. El cliente debe evitar tormentas de retries.

- Aplicar backoff exponencial con jitter.
- Limitar concurrencia por proveedor/aplicacion y, cuando corresponda, por conexion.
- Respetar el mecanismo de paginacion de cada endpoint; no mezclar scroll con offset/limit.
- Usar batching solo cuando el endpoint lo soporte.
- Registrar metricas de 429, latencia, endpoint y tenant sin tokens.
- Usar circuit breaker o pausa de cola cuando la cuota este agotada.
- No reintentar ciegamente errores de validacion, autorizacion o recursos inexistentes.

Revisar la documentacion oficial vigente antes de fijar valores de retry o cuota.