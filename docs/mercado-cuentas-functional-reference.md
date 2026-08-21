# MercadoCuentas — referencia funcional

## Límite de uso

MercadoCuentas es **REFERENCIA FUNCIONAL / DE PRODUCTO**. No es API, backend, dependencia, proveedor ni fuente de datos de e-ngenieria Hub. La investigación observó pantallas, navegación, DevTools, HAR y 86 screenshots relevantes; no equivale a 86 módulos, porque incluye estados, menús, tooltips y continuaciones de pantallas.

No se llaman, copian ni modelan contratos a partir de endpoints internos o rutas PHP/AJAX históricas. No se almacenan cookies, tokens, headers sensibles, credenciales ni secretos. Las rutas observadas solo sirvieron para inferir responsabilidades de producto.

La traducción correcta es: necesidad observada -> feature propia del e-Hub -> API oficial del provider, datos propios o cálculo propio.

## Inventario funcional observado

| Área | Necesidades observadas | Interpretación para e-Hub |
| --- | --- | --- |
| Dashboard | ventas, unidades, preguntas, visitas, dinero, pendientes y tiempos de respuesta | futuro centro operacional multi-Store |
| Ventas | ventas abiertas, compradores, presupuestos, reportes, eficiencia, conversión, preparación y facturación | capacidad futura separada; no copiar tablas ni campos |
| Productos/publicaciones | variantes, SKU, stock, precios, costos, edición, FULL, descuentos y estado | distinguir Product canónico, Listing, Inventory y Price |
| Inventario/precios | stock por SKU, reglas, sincronización, precios por familia/cantidad y promociones | conceptos posibles, no tablas aprobadas |
| Preguntas e IA | pendientes, histórico, bloqueos, respuestas y asistencia | feature propia; IA nunca es autoridad sensible |
| Operaciones masivas | importación de costos, stock, precios y publicaciones por Excel | futuro flujo con validación, preview, errores por fila y trazabilidad |
| Competencia/logística | seguimiento, preparación, picking, etiquetas y FLEX | validar capacidades en API oficial antes de diseñar |
| Automatización/notificaciones | eventos, condiciones, plantillas, Telegram y otros canales | arquitectura futura de delivery desacoplado |
| Multicanal | referencias a Tiendanube | confirma adapters independientes y provider-agnostic |

## Consecuencias de diseño

- La referencia no autoriza ningún módulo, tabla, endpoint, integración ni UI.
- Mercado Libre no define los modelos canónicos del producto; los DTOs se aíslan detrás de mappers.
- Las capacidades futuras se priorizan y aprueban por fases en [el plan](./plan-y-gobierno.md).
- Para integración real se usa una Developers Application, OAuth server-side y API oficial de Mercado Libre; ver [OAuth y API](./meli-mercadolibre-OAuth/API.md).
