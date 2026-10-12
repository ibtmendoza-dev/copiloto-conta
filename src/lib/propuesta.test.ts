// Pruebas de la propuesta para Costos (propuesta.mjs). Puras: sin base, sin Firestore, sin IA.
import { describe, it, expect } from 'vitest';
import { hoyEnMexico, catalogoDePropuesta, hayCatalogo, hayTipos, instruccionDePropuesta, normalizarPropuesta, textoDePropuesta, nombreDeTipoNuevo, idDeTipo, datosDeTipoNuevo, NINGUNA, NUEVO } from './propuesta.mjs';

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
    expect(normalizarPropuesta(mov({}), catalogo, hoy)).toEqual({ idPdvPropuesto: 'sucursal-calle11', fechaGasto: '2026-10-09', cuentas: ['gasolina', null, null], tipos: [null, null, null] });
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
    expect(normalizarPropuesta(mov({ contexto: 'PERSONAL' }), catalogo, hoy)).toEqual({ idPdvPropuesto: null, fechaGasto: null, cuentas: [null, null, null], tipos: [null, null, null] });
    expect(normalizarPropuesta(mov({}), catalogoDePropuesta([], []), hoy).cuentas).toEqual([null, null, null]);
  });
});

describe('textoDePropuesta', () => {
  it('lo dice en una línea, sin repetir cuentas', () => {
    expect(textoDePropuesta({ cuentas: ['gasolina', 'gasolina', null], idPdvPropuesto: 'sucursal-calle11', fechaGasto: '2026-10-10' }, catalogo)).toBe('Gasolina · Calle 11 · 10 de octubre');
    expect(textoDePropuesta({ cuentas: [null] }, catalogo)).toBe('');
  });
});

// El tipo de gasto (2026-10-12, incremento 9 de Costos operativos de lps-platform).
describe('el tipo de gasto', () => {
  const conTipos = catalogoDePropuesta(
    [{ id: 'gasolina', nombre: 'Gasolina', grupo: 'transporte' }, { id: 'alimentos', nombre: 'Alimentos', grupo: 'insumos-receta' }, { id: 'renta-de-cocina', nombre: 'Renta de cocina', grupo: 'operacion-cocina' }],
    [{ id: 'sucursal-calle11', nombre: 'Calle 11' }],
    [
      { id: 'gasolina', nombre: 'Gasolina o transporte', ayuda: 'gasolina, pasajes', cuentaId: 'gasolina' },
      { id: 'ingredientes', nombre: 'Ingredientes', ayuda: 'verdura, fruta', cuentaId: 'alimentos' },
      { id: 'hielo', nombre: 'Hielo', cuentaId: null },
      { id: 'bodega', nombre: 'Bodega', activa: false },
      { id: 'plaza', activa: false } // corrección sin nombre: se omite
    ]
  );
  const art = (tipoGasto, extra = {}) => ({ cuentaCosto: NINGUNA, tipoGasto, ...extra });
  const tiposDe = (articulos, contexto = 'NEGOCIO', cat = conTipos) => normalizarPropuesta({ contexto, articulos }, cat, hoy).tipos;

  it('el catálogo lleva los tipos de la lista, por nombre; sin tipos no se elige ninguno', () => {
    expect(conTipos.tipos.map((t) => t.id)).toEqual(['gasolina', 'hielo', 'ingredientes']);
    expect(hayTipos(conTipos)).toBe(true);
    expect(hayTipos(catalogo)).toBe(false);
    expect(tiposDe([art('gasolina')], 'NEGOCIO', catalogo)).toEqual([null]);
    expect(instruccionDePropuesta(catalogo, hoy)).not.toContain('tipoGasto');
  });

  it('la instrucción dice cada tipo con su cuenta, y cómo pedir uno nuevo', () => {
    const t = instruccionDePropuesta(conTipos, hoy);
    expect(t).toContain('- gasolina: Gasolina o transporte (gasolina, pasajes) → Gasolina');
    expect(t).toMatch(/- hielo: Hielo\n/);
    expect(t).toContain(`pon "${NUEVO}" en 'tipoGasto'`);
    expect(t).not.toContain('Bodega');
  });

  it('un tipo de la lista, por su id; uno inventado o quitado de la lista, ninguno', () => {
    expect(tiposDe([art('ingredientes'), art('inventado'), art('bodega'), art(NINGUNA), art(undefined)])).toEqual([{ id: 'ingredientes' }, null, null, null, null]);
  });

  it('uno nuevo lleva su nombre limpio y la cuenta que sugirió la IA, si existe', () => {
    expect(tiposDe([art(NUEVO, { tipoNuevo: '  renta de   cocina ', cuentaCosto: 'renta-de-cocina' }), art(NUEVO, { tipoNuevo: 'Gas de cocina', cuentaCosto: 'gas' })])).toEqual([
      { id: 'renta-de-cocina', nuevo: { nombre: 'Renta de cocina', cuentaSugerida: 'renta-de-cocina' } },
      { id: 'gas-de-cocina', nuevo: { nombre: 'Gas de cocina', cuentaSugerida: null } }
    ]);
  });

  it('uno "nuevo" que ya existe con ese nombre o ese id es el que existe', () => {
    expect(tiposDe([art(NUEVO, { tipoNuevo: 'HIELO' }), art(NUEVO, { tipoNuevo: 'Gasolina o Transporte' }), art(NUEVO, { tipoNuevo: 'ingredientes' })])).toEqual([{ id: 'hielo' }, { id: 'gasolina' }, { id: 'ingredientes' }]);
  });

  it('un nombre que no dice qué es, vacío o largo, no crea nada', () => {
    expect(tiposDe([art(NUEVO, { tipoNuevo: 'Otros gastos' }), art(NUEVO, { tipoNuevo: 'Insumo / Producto' }), art(NUEVO), art(NUEVO, { tipoNuevo: 'x'.repeat(41) })])).toEqual([null, null, null, null]);
    expect(nombreDeTipoNuevo('luz de sucursal')).toBe('Luz de sucursal');
  });

  it('el id es el de lps-platform: sin acentos, minúsculas y guiones', () => {
    expect(idDeTipo('Teléfono e Internet')).toBe('telefono-e-internet');
    expect(idDeTipo('  Gas  de cocina ')).toBe('gas-de-cocina');
  });

  it('lo personal no lleva tipo', () => {
    expect(tiposDe([art('gasolina')], 'PERSONAL')).toEqual([null]);
  });

  it('el documento del tipo nuevo nace sin cuenta, del Copiloto y a nombre de quien capturó', () => {
    const ahora = new Date('2026-10-12T18:00:00.000Z');
    expect(datosDeTipoNuevo({ nombre: 'Renta de cocina', cuentaSugerida: 'renta-de-cocina' }, { usuarioId: 'u1', ahora })).toEqual({
      nombre: 'Renta de cocina', cuentaId: null, cuentaSugerida: 'renta-de-cocina', activa: true, origen: 'copiloto', creadoPor: 'u1', creadoEn: ahora.toISOString()
    });
  });

  it('el chat dice los tipos, y avisa del nuevo; sin tipos, las cuentas como antes', () => {
    expect(textoDePropuesta({ cuentas: ['alimentos', 'renta-de-cocina'], tipos: [{ id: 'ingredientes' }, { id: 'renta-de-cocina', nuevo: { nombre: 'Renta de cocina', cuentaSugerida: null } }], idPdvPropuesto: 'sucursal-calle11' }, conTipos))
      .toBe('Ingredientes, «Renta de cocina» (tipo nuevo, falta su cuenta) · Calle 11');
    expect(textoDePropuesta({ cuentas: ['gasolina'], tipos: [null] }, conTipos)).toBe('Gasolina');
  });
});
