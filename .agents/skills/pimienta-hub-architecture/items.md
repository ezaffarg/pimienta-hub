# Items y Listings

Mantener separadas publicaciones, productos de catalogo, user products,
variaciones, imagenes, categorias, atributos, precio y stock. No asumir que una
capacidad existe o falta: consultar `docs/meli-api.md` y el código vigente.

Los DTOs de Mercado Libre viven en `src/integrations/mercado-libre/`. Los
mappers producen modelos internos, preservan identidad externa para
idempotencia y distinguen timestamps del provider del reloj local. Missing
reconciliation, lifecycle y writes requieren contratos y autorización propios.
