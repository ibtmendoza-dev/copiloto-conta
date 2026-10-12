// Pruebas de la propuesta para Costos (propuesta.mjs). Puras: sin base, sin Firestore, sin IA.
import { describe, it, expect } from 'vitest';
import { hoyEnMexico, catalogoDePropuesta, hayCatalogo, instruccionDePropuesta, normalizarPropuesta, textoDePropuesta, NINGUNA } from './propuesta.mjs';

const catalogo = catalogoDePropuesta(
  [
    { id: 'gasolina', nombre: 'Gasolina', grupo: 'transporte', activa: true },
    { id: 'renta-de-cocina', nombre: 'Renta de cocina', grupo: 'operacion-cocina', nota: '' },
    { id: 'luz-de-sucursal', nombre: 'Luz de sucursal', grupo: 'costo-de-venta', nota: 'Por ejemplo, la luz de Calle 11.' },
    { id: 'vieja', nombre: 'Vieja', grupo: 'transporte', activa: false }
  ],
  [{ id: 'sucursal-calle11', nombre: 'Calle 11' }, { id: 'sucursal-unitec', nombre: 'Unitec' }]
);
const hoy = '2026-10-12';

describe('hoyEnMexico', () => {
  it('es el día de la Ciudad de México, no el de Greenwich', () => {
    expect(hoyEnMexico(new Date('2026-10-12T05:00:00.000Z'))).toBe('2026-10-11');
    expect(hoyEnMexico(new Date('2026-10-12T07:00:00.000Z'))).toBe('2026-10-12');
  });
});

describe('el catálogo', () => {
  it('solo las cuentas activas, con las sucursales', () => {
    expect(catalogo.cuentas.map((c) => c.id)).toEqual(['luz-de-sucursal', 'renta-de-cocina', 'gasolina']);
    expect(catalogo.pdvs.map((p) => p.id)).toEqual(['sucursal-calle11', 'sucursal-unitec']);
    expect(hayCatalogo(catalogo)).toBe(true);
    expect(hayCatalogo(catalogoDePropuesta([], []))).toBe(false);
  });

  it('la instrucción lleva los ids, las sucursales, la fecha de hoy y la regla del mes', () => {
    const t = instruccionDePropuesta(catalogo, hoy);
    expect(t).toContain('- gasolina: Gasolina');
    expect(t).toContain('- sucursal-calle11: Calle 11');
    expect(t).toContain('Hoy es 2026-10-12');
    expect(t).toContain('el día 1 de ese mes');
    expect(t).not.toContain('vieja');
  });
});

describe('normalizarPropuesta', () => {
  const mov = (extra) => ({ contexto: 'NEGOCIO', sucursal: 'sucursal-calle11', fechaGasto: '2026-10-09', articulos: [{ cuentaCosto: 'gasolina' }, { cuentaCosto: 'inventada' }, { cuentaCosto: NINGUNA }], ...extra });

  it('se queda con lo que existe en el catálogo', () => {
    expect(normalizarPropuesta(mov({}), catalogo, hoy)).toEqual({ idPdvPropuesto: 'sucursal-calle11', fechaGasto: '2026-10-09', cuentas: ['gasolina', null, null] });
  });

  it('una sucursal que no existe o "ninguna" no se guarda', () => {
    expect(normalizarPropuesta(mov({ sucursal: 'sucursal-luna' }), catalogo, hoy).idPdvPropuesto).toBeNull();
    expect(normalizarPropuesta(mov({ sucursal: NINGUNA }), catalogo, hoy).idPdvPropuesto).toBeNull();
  });

  it('la fecha: ni en el futuro, ni de hace más de un año, ni mal escrita; vacía es vacía', () => {
    expect(normalizarPropuesta(mov({ fechaGasto: '2026-10-13' }), catalogo, hoy).fechaGasto).toBeNull();
    expect(normalizarPropuesta(mov({ fechaGasto: '2025-10-01' }), catalogo, hoy).fechaGasto).toBeNull();
    expect(normalizarPropuesta(mov({ fechaGasto: '9 de octubre' }), catalogo, hoy).fechaGasto).toBeNull();
    expect(normalizarPropuesta(mov({ fechaGasto: '' }), catalogo, hoy).fechaGasto).toBeNull();
    expect(normalizarPropuesta(mov({ fechaGasto: '2026-09-01' }), catalogo, hoy).fechaGasto).toBe('2026-09-01');
    expect(normalizarPropuesta(mov({ fechaGasto: hoy }), catalogo, hoy).fechaGasto).toBe(hoy);
  });

  it('lo personal, o sin catálogo, no lleva propuesta', () => {
    expect(normalizarPropuesta(mov({ contexto: 'PERSONAL' }), catalogo, hoy)).toEqual({ idPdvPropuesto: null, fechaGasto: null, cuentas: [null, null, null] });
    expect(normalizarPropuesta(mov({}), catalogoDePropuesta([], []), hoy).cuentas).toEqual([null, null, null]);
  });
});

describe('textoDePropuesta', () => {
  it('lo dice en una línea, sin repetir cuentas', () => {
    expect(textoDePropuesta({ cuentas: ['gasolina', 'gasolina', null], idPdvPropuesto: 'sucursal-calle11', fechaGasto: '2026-10-10' }, catalogo)).toBe('Gasolina · Calle 11 · 10 de octubre');
    expect(textoDePropuesta({ cuentas: [null] }, catalogo)).toBe('');
  });
});
