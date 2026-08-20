# Mapa de API Mercado Libre

## Primer hito

Solo OAuth, cuenta autorizada y estado de conexion.

## Fases posteriores

- Items: publicaciones, categorias, atributos, variaciones, imagenes, precio y stock.
- Inventario: user products y stock.
- Ordenes: ordenes, packs, pagos, descuentos, feedback y fraude.
- Preguntas: busqueda, respuesta y moderacion.
- Envios: shipment, estados, SLA, tracking y costos.
- Notificaciones: topics, idempotencia y recuperacion.

Cada recurso debe tener DTO, mapper, errores y tests contractuales propios dentro del adapter. Consultar la documentacion oficial vigente antes de fijar contratos.