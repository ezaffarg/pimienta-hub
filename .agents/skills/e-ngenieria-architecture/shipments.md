# Shipments

Fase posterior. Revisar siempre la documentacion vigente antes de consumir envios porque existen cambios de formato, headers obligatorios, PII condicional, estados y deprecaciones.

El adapter debe encapsular `x-format-new`, relaciones order/shipment, tipos forward/return, SLA, historiales, costos y propagation asincrona. No exponer direcciones o telefonos al dominio si no son necesarios; aplicar minimizacion de PII.