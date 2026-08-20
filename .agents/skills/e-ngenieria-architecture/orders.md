# Orders

Fase posterior. Usar el adapter y modelos canonicos, nunca DTOs de Mercado Libre fuera de la integracion.

Documentar antes de implementar `orders_v2`, estados, pagos, fraude, packs, descuentos, feedback, respuestas 206 y relacion con shipments. Los cambios externos se consultan por recurso y se mapean de forma tolerante a campos ausentes/deprecados.

Toda operacion debe respetar seller/account ownership y tenant isolation.