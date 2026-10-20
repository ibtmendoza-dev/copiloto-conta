// Pruebas del reparto de la comisión de entrega de verduras (verduras.ts),
// con los tres mensajes reales del proveedor. Puras: sin IA, base ni Firestore.
import { describe, it, expect } from 'vitest';
import { repartirComisionDeVerduras, repartirCentavos, textoDeReparto, REGLAS_VERDURAS } from './verduras';

const v = (cantidad: number, descripcion: string, importeTotal: number, extra: Record<string, unknown> = {}) => ({
  cantidad, descripcion, importeTotal, precioUnitario: importeTotal / cantidad, esVerdura: true, porPeso: false, cargoDeEntrega: false, esInsumo: true, ...extra
});
const comision = (importeTotal: number) => ({
  cantidad: 1, descripcion: 'Comisión de entrega', importeTotal, precioUnitario: importeTotal, esVerdura: false, porPeso: false, cargoDeEntrega: true, esInsumo: false
});
const suma = (arts: { importeTotal: number }[]) => Math.round(arts.reduce((s, a) => s + a.importeTotal, 0) * 100) / 100;
const precio = (mov: { articulos: { descripcion: string; precioUnitario: number }[] }, d: string) => mov.articulos.find((a) => a.descripcion === d)?.precioUnitario;

// "200+150+150+150+150+300=1100" (miércoles 14-oct)
const del14 = { importe: 1100, articulos: [v(2, 'Zanahoria', 200), v(1, 'Pepino', 150), v(1, 'Morrón', 150), v(1, 'Calabaza', 150), v(1, 'Limón', 150), comision(300)] };
// "300+200+800+400+200+400=2300" (7-oct): la cebolla, por kilo.
const del7 = { importe: 2300, articulos: [v(3, 'Zanahoria', 300), v(1, 'Pepino', 200), v(20, 'Cebolla', 800, { porPeso: true }), v(2, 'Calabaza', 400), v(2, 'Morrón', 200), comision(400)] };
// "200+100+600+400+300+350", Total: 1950 (30-sep)
const del30 = { importe: 1950, articulos: [v(2, 'Morrón', 200), v(1, 'Zanahoria', 100), v(15, 'Cebolla', 600, { porPeso: true }), v(2, 'Limón', 400), v(2, 'Calabaza', 300), comision(350)] };

describe('repartirComisionDeVerduras, con los mensajes reales', () => {
  it('14-oct: $300 entre 6 paquetes, $50 cada uno', () => {
    const { movimiento, reparto } = repartirComisionDeVerduras(del14);
    expect(movimiento.articulos.map((a) => a.descripcion)).toEqual(['Zanahoria', 'Pepino', 'Morrón', 'Calabaza', 'Limón']);
    expect(precio(movimiento, 'Zanahoria')).toBe(150);
    expect(precio(movimiento, 'Pepino')).toBe(200);
    expect(precio(movimiento, 'Limón')).toBe(200);
    expect(suma(movimiento.articulos)).toBe(1100);
    expect(reparto).toEqual({ comision: 300, criterio: 'paquete', paquetes: 6, sinComision: [] });
  });

  it('7-oct: la cebolla por kilo no paga; $400 entre 8 paquetes', () => {
    const { movimiento, reparto } = repartirComisionDeVerduras(del7);
    expect(precio(movimiento, 'Cebolla')).toBe(40);
    expect(precio(movimiento, 'Zanahoria')).toBe(150);
    expect(precio(movimiento, 'Calabaza')).toBe(250);
    expect(precio(movimiento, 'Morrón')).toBe(150);
    expect(suma(movimiento.articulos)).toBe(2300);
    expect(reparto?.paquetes).toBe(8);
    expect(reparto?.sinComision).toEqual(['Cebolla']);
  });

  it('30-sep: $350 entre 7 paquetes', () => {
    const { movimiento, reparto } = repartirComisionDeVerduras(del30);
    expect(precio(movimiento, 'Morrón')).toBe(150);
    expect(precio(movimiento, 'Limón')).toBe(250);
    expect(precio(movimiento, 'Cebolla')).toBe(40);
    expect(suma(movimiento.articulos)).toBe(1950);
    expect(reparto?.paquetes).toBe(7);
  });

  it('dice qué hizo, en una línea', () => {
    expect(textoDeReparto(repartirComisionDeVerduras(del14).reparto)).toBe('$300 repartidos en el precio de 6 paquetes ($50 cada uno).');
    expect(textoDeReparto(repartirComisionDeVerduras(del7).reparto)).toBe('$400 repartidos en el precio de 8 paquetes ($50 cada uno); cebolla va por kilo y no la paga.');
    expect(textoDeReparto(null)).toBe('');
  });
});

describe('repartirComisionDeVerduras, solo verduras', () => {
  it('no toca un movimiento sin comisión de entrega', () => {
    const mov = { articulos: [v(2, 'Zanahoria', 200)] };
    expect(repartirComisionDeVerduras(mov)).toEqual({ movimiento: mov, reparto: null });
  });

  it('no reparte si algo del movimiento no es verdura: el envío se queda como está', () => {
    const mov = { articulos: [v(2, 'Zanahoria', 200), v(1, 'Kiwi', 900, { esVerdura: false }), comision(100)] };
    expect(repartirComisionDeVerduras(mov)).toEqual({ movimiento: mov, reparto: null });
  });

  it('no reparte un flete que no viene marcado como comisión de entrega de verduras', () => {
    const flete = { ...comision(250), descripcion: 'Flete', cargoDeEntrega: false };
    const mov = { articulos: [v(2, 'Zanahoria', 200), flete] };
    expect(repartirComisionDeVerduras(mov).reparto).toBeNull();
  });

  it('si todo fue por kilo, reparte en proporción al importe', () => {
    const mov = { articulos: [v(10, 'Cebolla', 400, { porPeso: true }), v(5, 'Chile serrano', 100, { porPeso: true }), comision(50)] };
    const { movimiento, reparto } = repartirComisionDeVerduras(mov);
    expect(reparto?.criterio).toBe('importe');
    expect(movimiento.articulos.map((a) => a.importeTotal)).toEqual([440, 110]);
  });
});

describe('repartirCentavos', () => {
  it('no pierde ni sobra un centavo', () => {
    const partes = repartirCentavos(10000, [1, 1, 1]);
    expect(partes.reduce((a, b) => a + b, 0)).toBe(10000);
    expect(partes).toEqual([3334, 3333, 3333]);
  });
  it('sin pesos, nada', () => {
    expect(repartirCentavos(500, [0, 0])).toEqual([0, 0]);
  });
});

describe('REGLAS_VERDURAS', () => {
  it('limita el reparto a la comisión de las verduras', () => {
    expect(REGLAS_VERDURAS).toContain("'cargoDeEntrega' = true SOLO para la comisión de entrega de una compra de verduras");
    expect(REGLAS_VERDURAS).toContain('La cebolla de este proveedor siempre es por kilo');
  });
});
