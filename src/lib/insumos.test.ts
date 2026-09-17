// Pruebas del puente por artículo (insumos.ts). Puras: sin base ni Firestore.
import { describe, it, expect } from 'vitest';
import { articulosParaAlmacen, debeInyectar, payloadEntradaAlmacen, accionDePuente, REGLAS_INSUMO, type MovimientoParaAlmacen } from './insumos';

const fecha = new Date('2026-09-11T20:00:00.000Z');
const costco: MovimientoParaAlmacen = {
  id: 'mov-1',
  contexto: 'NEGOCIO',
  categoria: 'ALIMENTOS',
  fechaOcurrencia: fecha,
  importe: '1700.50',
  usuarioId: 'usr-1',
  conceptos: [
    { cantidad: 1, descripcion: 'QUESO PANELA 1.1KG', precioUnitario: 150, importeTotal: 150, esInsumo: true },
    { cantidad: 1, descripcion: 'KRUPS CAFETERA 14C', precioUnitario: 1200, importeTotal: 1200, esInsumo: false },
    { cantidad: 2, descripcion: 'CHAMP. BLANCO 1 KG', precioUnitario: 175.25, importeTotal: 350.5, esInsumo: true }
  ]
};

describe('articulosParaAlmacen', () => {
  it('con categoría ALIMENTOS viajan solo los marcados como insumo', () => {
    expect(articulosParaAlmacen(costco).map((a) => a.descripcion)).toEqual(['QUESO PANELA 1.1KG', 'CHAMP. BLANCO 1 KG']);
  });

  it('la categoría INVENTARIO no es un caso aparte: manda la marca de cada artículo', () => {
    const inventario = { ...costco, categoria: 'INVENTARIO' };
    expect(articulosParaAlmacen(inventario)).toHaveLength(2);
    const sinMarcas = { ...inventario, conceptos: costco.conceptos.map((c) => ({ ...c, esInsumo: undefined })) };
    expect(articulosParaAlmacen(sinMarcas)).toEqual([]);
  });

  it('sin conceptos no hay nada', () => {
    expect(articulosParaAlmacen({ ...costco, conceptos: [] })).toEqual([]);
  });
});

describe('debeInyectar', () => {
  it('NEGOCIO con algún insumo sí; PERSONAL nunca; NEGOCIO sin insumos no', () => {
    expect(debeInyectar(costco)).toBe(true);
    expect(debeInyectar({ ...costco, contexto: 'PERSONAL' })).toBe(false);
    expect(debeInyectar({ ...costco, conceptos: costco.conceptos.map((c) => ({ ...c, esInsumo: false })) })).toBe(false);
    expect(debeInyectar({ ...costco, categoria: 'OTROS', conceptos: [{ cantidad: 1, descripcion: 'Propina', precioUnitario: 50, importeTotal: 50 }] })).toBe(false);
  });
});

describe('payloadEntradaAlmacen', () => {
  it('lleva solo los insumos, suma su gasto, y conserva el importe completo y el id del movimiento', () => {
    const p = payloadEntradaAlmacen(costco);
    expect(p.origen).toBe('Copiloto Conta (Finanzas)');
    expect(p.categoria).toBe('ALIMENTOS');
    expect(p.movimientoId).toBe('mov-1');
    expect(p.totalGastado).toBeCloseTo(500.5, 9);
    expect(p.importeMovimiento).toBe(1700.5);
    expect(p.usuarioId).toBe('usr-1');
    expect(p.fechaOcurrencia).toBe(fecha);
    expect(p.articulos).toEqual([
      { cantidad: 1, descripcion: 'QUESO PANELA 1.1KG', precioUnitario: 150, importeTotal: 150 },
      { cantidad: 2, descripcion: 'CHAMP. BLANCO 1 KG', precioUnitario: 175.25, importeTotal: 350.5 }
    ]);
  });

  it('los Decimal de Prisma pasan a número y los nulos se quedan nulos', () => {
    const p = payloadEntradaAlmacen({ ...costco, importe: { toString: () => '99.9' }, conceptos: [{ cantidad: 1, descripcion: 'X', precioUnitario: null, importeTotal: 10, esInsumo: true }] });
    expect(p.importeMovimiento).toBe(99.9);
    expect(p.articulos[0].precioUnitario).toBeNull();
  });
});

describe('accionDePuente', () => {
  const sinInsumos = { ...costco, conceptos: costco.conceptos.map((c) => ({ ...c, esInsumo: false })) };

  it('crear cuando debe y no tiene; actualizar cuando debe y tiene', () => {
    expect(accionDePuente({ ...costco, entradaAlmacenId: null })).toBe('crear');
    expect(accionDePuente({ ...costco, entradaAlmacenId: 'doc-1' })).toBe('actualizar');
  });

  it('retirar cuando ya no debe pero tiene; nada cuando ni debe ni tiene', () => {
    expect(accionDePuente({ ...sinInsumos, entradaAlmacenId: 'doc-1' })).toBe('retirar');
    expect(accionDePuente({ ...sinInsumos, entradaAlmacenId: null })).toBe('nada');
    expect(accionDePuente({ ...costco, contexto: 'PERSONAL', entradaAlmacenId: 'doc-1' })).toBe('retirar');
  });
});

describe('REGLAS_INSUMO', () => {
  it('nombra los dos lados de la regla, para que el prompt y el guion digan lo mismo', () => {
    expect(REGLAS_INSUMO).toMatch(/'esInsumo' = true/);
    expect(REGLAS_INSUMO).toMatch(/'esInsumo' = false/);
    expect(REGLAS_INSUMO).toMatch(/PERSONAL/);
  });
});
