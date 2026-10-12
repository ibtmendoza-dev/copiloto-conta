// Pruebas del espejo en la plataforma (espejo.mjs). Puras: sin base ni Firestore.
import { describe, it, expect } from 'vitest';
import { debeEspejar, payloadMovimientoFinanzas, cotejarEspejo, mesLocal, COLECCION_ESPEJO } from './espejo.mjs';

// Un Decimal de Prisma se comporta así para Number(): por su texto.
const decimal = (texto: string) => ({ toString: () => texto, valueOf: () => texto });

const fecha = new Date('2026-10-05T16:30:00.000Z');
const ahora = new Date('2026-10-11T22:00:00.000Z');
const renta = {
  id: 'mov-renta',
  contexto: 'NEGOCIO',
  tipo: 'gasto',
  categoria: 'OTROS',
  fechaOcurrencia: fecha,
  importe: decimal('8000.00'),
  subtotal: null,
  iva: null,
  contraparteNombre: 'Arrendador',
  descripcionOriginal: 'pagué la renta de la cocina 8000',
  estado: 'PENDIENTE_COMPROBANTE',
  usuarioId: 'usr-1',
  entradaAlmacenId: null,
  conceptos: [{ id: 'c-1', cantidad: decimal('1'), descripcion: 'Renta de cocina octubre', precioUnitario: decimal('8000'), importeTotal: decimal('8000'), esInsumo: false }]
};
const costco = {
  ...renta,
  id: 'mov-costco',
  categoria: 'ALIMENTOS',
  importe: decimal('1700.506'),
  subtotal: decimal('1466.0'),
  iva: decimal('234.5049'),
  entradaAlmacenId: 'entrada-1',
  conceptos: [
    { id: 'c-2', cantidad: decimal('0.125'), descripcion: 'QUESO PANELA', precioUnitario: decimal('1200.004'), importeTotal: decimal('150.0005'), esInsumo: true },
    { id: 'c-3', cantidad: decimal('1'), descripcion: 'KRUPS CAFETERA', precioUnitario: null, importeTotal: decimal('1200'), esInsumo: false },
    { id: 'c-4', cantidad: decimal('2'), descripcion: 'CHAMP. BLANCO', precioUnitario: decimal('175.25'), importeTotal: decimal('350.5'), esInsumo: true }
  ]
};

describe('debeEspejar', () => {
  it('solo lo del negocio; lo personal se queda en el Copiloto', () => {
    expect(debeEspejar(renta)).toBe(true);
    expect(debeEspejar({ ...renta, contexto: 'PERSONAL' })).toBe(false);
    expect(debeEspejar(null as any)).toBe(false);
  });
});

describe('payloadMovimientoFinanzas', () => {
  it('lleva la forma del contrato, con el id del movimiento y la marca de origen', () => {
    const p = payloadMovimientoFinanzas(renta, ahora);
    expect(COLECCION_ESPEJO).toBe('movimientos_finanzas');
    expect(p).toMatchObject({
      movimientoId: 'mov-renta',
      origen: 'copiloto-conta',
      version: 3,
      contexto: 'NEGOCIO',
      tipo: 'GASTO',
      categoria: 'OTROS',
      importe: 8000,
      subtotal: null,
      iva: null,
      contraparte: 'Arrendador',
      descripcionOriginal: 'pagué la renta de la cocina 8000',
      estado: 'PENDIENTE_COMPROBANTE',
      usuarioId: 'usr-1',
      entradaAlmacenId: null,
      espejadoEn: '2026-10-11T22:00:00.000Z'
    });
  });

  it('momento es el mismo instante que fechaOcurrencia, en texto', () => {
    const p = payloadMovimientoFinanzas(renta, ahora);
    expect(p.fechaOcurrencia).toEqual(fecha);
    expect(p.momento).toBe('2026-10-05T16:30:00.000Z');
    expect(new Date(p.momento).getTime()).toBe(p.fechaOcurrencia.getTime());
  });

  it('los importes van a centavos; la cantidad no es dinero y no se redondea', () => {
    const p = payloadMovimientoFinanzas(costco, ahora);
    expect(p.importe).toBe(1700.51);
    expect(p.subtotal).toBe(1466);
    expect(p.iva).toBe(234.5);
    expect(p.conceptos[0]).toEqual({ id: 'c-2', cantidad: 0.125, descripcion: 'QUESO PANELA', precioUnitario: 1200, importeTotal: 150, esInsumo: true, cuentaPropuesta: null, tipoGasto: null });
  });

  it('viajan TODOS los artículos, no solo los insumos, cada uno con su marca', () => {
    const p = payloadMovimientoFinanzas(costco, ahora);
    expect(p.conceptos.map((c) => [c.descripcion, c.esInsumo])).toEqual([
      ['QUESO PANELA', true],
      ['KRUPS CAFETERA', false],
      ['CHAMP. BLANCO', true]
    ]);
    expect(p.conceptos[1].precioUnitario).toBeNull();
  });

  it('lleva entradaAlmacenId: sin él la plataforma contaría dos veces los insumos', () => {
    expect(payloadMovimientoFinanzas(costco, ahora).entradaAlmacenId).toBe('entrada-1');
  });

  it('ningún campo queda undefined: Firestore no lo acepta', () => {
    const minimo = { id: 'm', tipo: 'GASTO', fechaOcurrencia: fecha, importe: 10 };
    const p = payloadMovimientoFinanzas(minimo, ahora);
    expect(Object.entries(p).filter(([, v]) => v === undefined)).toEqual([]);
    expect(p.conceptos).toEqual([]);
  });
});

describe('mesLocal', () => {
  it('el mes es el de la Ciudad de México, no el de Greenwich', () => {
    expect(mesLocal('2026-10-01T03:00:00.000Z')).toBe('2026-09');
    expect(mesLocal('2026-10-01T07:00:00.000Z')).toBe('2026-10');
  });
});

describe('cotejarEspejo', () => {
  const esperados = [payloadMovimientoFinanzas(renta, ahora), payloadMovimientoFinanzas(costco, ahora)];

  it('cuadra cuando el espejo tiene lo mismo, aunque se haya escrito en otro momento', () => {
    const presentes = esperados.map((e) => ({ ...e, espejadoEn: '2026-10-06T00:00:00.000Z' }));
    const r = cotejarEspejo(esperados, presentes);
    expect(r.cuadra).toBe(true);
    expect(r.porMes).toEqual([{ mes: '2026-10', neon: { movimientos: 2, total: 9700.51 }, espejo: { movimientos: 2, total: 9700.51 }, cuadra: true }]);
  });

  it('dice qué falta, qué sobra y qué difiere', () => {
    const marcaCambiada = { ...esperados[1], conceptos: esperados[1].conceptos.map((c) => ({ ...c, esInsumo: false })) };
    const huerfano = { ...esperados[0], movimientoId: 'mov-borrado', importe: 2780 };
    const r = cotejarEspejo(esperados, [marcaCambiada, huerfano]);
    expect(r.cuadra).toBe(false);
    expect(r.faltan.map((e) => e.movimientoId)).toEqual(['mov-renta']);
    expect(r.difieren.map((e) => e.movimientoId)).toEqual(['mov-costco']);
    expect(r.sobran.map((d) => d.movimientoId)).toEqual(['mov-borrado']);
  });

  it('el mes no cuadra si cambia el total aunque el número de movimientos sea igual', () => {
    const r = cotejarEspejo(esperados, [esperados[0], { ...esperados[1], importe: 1700 }]);
    expect(r.porMes[0].cuadra).toBe(false);
    expect(r.difieren.map((e) => e.movimientoId)).toEqual(['mov-costco']);
  });

  it('sin nada en el espejo, todo falta', () => {
    const r = cotejarEspejo(esperados, []);
    expect(r.faltan).toHaveLength(2);
    expect(r.porMes[0].espejo).toEqual({ movimientos: 0, total: 0 });
  });
});

describe('la propuesta para Costos (versión 2, 2026-10-12)', () => {
  it('viaja la cuenta propuesta de cada artículo, la sucursal y la fecha del gasto', () => {
    const conPropuesta = {
      ...costco, idPdvPropuesto: 'sucursal-calle11', fechaGasto: '2026-10-04',
      conceptos: costco.conceptos.map((c, i) => ({ ...c, cuentaCostoPropuesta: i === 1 ? 'equipo-menor' : null }))
    };
    const p = payloadMovimientoFinanzas(conPropuesta, ahora);
    expect(p).toMatchObject({ version: 3, idPdvPropuesto: 'sucursal-calle11', fechaGasto: '2026-10-04' });
    expect(p.conceptos.map((c) => c.cuentaPropuesta)).toEqual([null, 'equipo-menor', null]);
  });

  it('sin propuesta, todo en null; y un documento de la versión 1 coteja igual que uno sin propuesta', () => {
    const p = payloadMovimientoFinanzas(renta, ahora);
    expect(p).toMatchObject({ idPdvPropuesto: null, fechaGasto: null });
    expect(p.conceptos[0].cuentaPropuesta).toBeNull();
    const deVersion1 = { ...p, version: 1, conceptos: p.conceptos.map(({ cuentaPropuesta, ...c }) => c) };
    delete deVersion1.idPdvPropuesto;
    delete deVersion1.fechaGasto;
    expect(cotejarEspejo([p], [deVersion1]).cuadra).toBe(true);
  });

  it('si la propuesta cambió, difiere y se vuelve a escribir', () => {
    const p = payloadMovimientoFinanzas(renta, ahora);
    const otra = { ...p, conceptos: p.conceptos.map((c) => ({ ...c, cuentaPropuesta: 'renta-de-cocina' })) };
    expect(cotejarEspejo([otra], [p]).difieren).toHaveLength(1);
  });
});

describe('el tipo de gasto (versión 3, 2026-10-12)', () => {
  it('viaja el tipo que eligió la IA en cada artículo', () => {
    const conTipo = { ...costco, conceptos: costco.conceptos.map((c, i) => ({ ...c, tipoGastoId: i === 0 ? 'ingredientes' : null })) };
    const p = payloadMovimientoFinanzas(conTipo, ahora);
    expect(p.version).toBe(3);
    expect(p.conceptos.map((c) => c.tipoGasto)).toEqual(['ingredientes', null, null]);
  });

  it('un documento de antes, sin tipo, coteja igual que uno sin tipo; si el tipo cambió, difiere', () => {
    const p = payloadMovimientoFinanzas(renta, ahora);
    const deVersion2 = { ...p, version: 2, conceptos: p.conceptos.map(({ tipoGasto, ...c }) => c) };
    expect(cotejarEspejo([p], [deVersion2]).cuadra).toBe(true);
    const otro = { ...p, conceptos: p.conceptos.map((c) => ({ ...c, tipoGasto: 'renta-de-cocina' })) };
    expect(cotejarEspejo([otro], [p]).difieren).toHaveLength(1);
  });
});

