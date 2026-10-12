// Lo que la IA propone al capturar un gasto del negocio, para la pestaña Costos
// de la plataforma (LPS Platform): la cuenta de costo de cada artículo, la
// sucursal si el texto la dice y el día real del gasto (2026-10-12, incremento
// 7 de Costos operativos, ver lps-platform/docs/DISENO-costos-operativos.md
// §7.2 y §11).
//
// POR QUÉ. Hasta hoy la plataforma clasificaba cada artículo con las reglas de
// Dirección, y lo que ninguna reconocía se quedaba "por clasificar". La IA ya
// lee el ticket; con el catálogo de cuentas a la vista puede proponer dónde va
// cada cosa. PROPONE, NO DECIDE: en la plataforma las reglas de Dirección
// mandan sobre la propuesta, y lo propuesto queda a la vista para confirmarlo
// (lps-platform ClasificacionGastoService).
//
// LA FECHA. El Copiloto fecha cada movimiento al registrarlo
// (fechaOcurrencia). Una renta capturada el 3 de noviembre quedaba en
// noviembre. `fechaGasto` es aparte: el día en que pasó, si el texto o el
// ticket lo dicen; fechaOcurrencia no se toca, es la del registro contable.
//
// POR QUÉ ES .mjs: lo usan la acción del servidor y los guiones (igual que
// espejo.mjs). Todo es puro: sin base, sin Firestore, sin IA; probado en
// propuesta.test.ts.

export const NINGUNA = 'ninguna';

/** La fecha de hoy en la Ciudad de México, 'AAAA-MM-DD'. */
export function hoyEnMexico(ahora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ahora);
  const v = (t) => partes.find((p) => p.type === t)?.value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}

/**
 * Lo que la IA necesita del catálogo de la plataforma: las cuentas activas y
 * las sucursales. Lee documentos de `cuentas_costo` y `puntos_venta`.
 */
export function catalogoDePropuesta(cuentas = [], pdvs = []) {
  return {
    cuentas: cuentas
      .filter((c) => c && c.id && c.activa !== false)
      .map((c) => ({ id: c.id, nombre: c.nombre || c.id, grupo: c.grupo || '', nota: c.nota || '' }))
      .sort((a, b) => a.grupo.localeCompare(b.grupo) || a.nombre.localeCompare(b.nombre, 'es')),
    pdvs: pdvs
      .filter((p) => p && p.id)
      .map((p) => ({ id: p.id, nombre: p.nombre || p.id }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  };
}

/** Si hay catálogo con qué proponer. Sin él, la captura sigue igual que antes. */
export const hayCatalogo = (catalogo) => Boolean(catalogo && catalogo.cuentas.length > 0);

/**
 * El texto que va en la instrucción a la IA. Dice qué cuentas existen, qué
 * sucursales, y cómo decidir la fecha, con la fecha de hoy para entender
 * "ayer" o "el viernes".
 */
export function instruccionDePropuesta(catalogo, hoy) {
  const cuentas = catalogo.cuentas.map((c) => `- ${c.id}: ${c.nombre}${c.nota ? ` (${c.nota})` : ''}`).join('\n');
  const pdvs = catalogo.pdvs.map((p) => `- ${p.id}: ${p.nombre}`).join('\n');
  return `
      CLASIFICACIÓN PARA COSTOS (solo movimientos del NEGOCIO; en PERSONAL usa "${NINGUNA}" y deja la fecha vacía):
      - En cada artículo, 'cuentaCosto' es el id de la cuenta de costo a la que va, de esta lista. Si ninguna le queda clara, "${NINGUNA}". No inventes ids.
${cuentas}
      - Los ingredientes y empaques de las recetas van a 'alimentos' o a 'empaque-y-desechables-de-producto'. Bolsas, servilletas y tenedores que se entregan al vender van a 'desechables-de-venta'.
      - 'sucursal' es el id de la sucursal SOLO si el mensaje la nombra (por ejemplo "la luz de Calle 11"). Si no, "${NINGUNA}". Sucursales:
${pdvs}
      - 'fechaGasto' es el día en que se hizo el gasto, AAAA-MM-DD, SOLO si el mensaje o el ticket lo dicen. Hoy es ${hoy}: "ayer" es el día anterior; "el viernes", el último viernes. Si el gasto corresponde a un mes ("la renta de septiembre"), usa el día 1 de ese mes. Si no lo dicen, déjalo vacío: no pongas la fecha de hoy.`;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const diasEntre = (a, b) => Math.round((Date.UTC(...b.split('-').map((x, i) => (i === 1 ? x - 1 : +x))) - Date.UTC(...a.split('-').map((x, i) => (i === 1 ? x - 1 : +x)))) / 86400000);

/**
 * Lo que devolvió la IA, revisado: un id que no está en el catálogo es
 * "ninguna"; una fecha en el futuro, de hace más de un año o mal escrita, no
 * se guarda. Lo personal no lleva propuesta.
 *
 * @param {{ contexto: string, sucursal?: string, fechaGasto?: string, articulos: Array<{ cuentaCosto?: string }> }} mov
 * @returns {{ idPdvPropuesto: string|null, fechaGasto: string|null, cuentas: Array<string|null> }}
 */
export function normalizarPropuesta(mov, catalogo, hoy) {
  const articulos = Array.isArray(mov?.articulos) ? mov.articulos : [];
  if (!hayCatalogo(catalogo) || mov?.contexto !== 'NEGOCIO') {
    return { idPdvPropuesto: null, fechaGasto: null, cuentas: articulos.map(() => null) };
  }
  const idsCuenta = new Set(catalogo.cuentas.map((c) => c.id));
  const idsPdv = new Set(catalogo.pdvs.map((p) => p.id));
  const fecha = String(mov.fechaGasto || '').trim();
  const fechaValida = FECHA.test(fecha) && !Number.isNaN(Date.parse(`${fecha}T12:00:00Z`)) && fecha <= hoy && diasEntre(fecha, hoy) <= 366;
  return {
    idPdvPropuesto: idsPdv.has(mov.sucursal) ? mov.sucursal : null,
    fechaGasto: fechaValida ? fecha : null,
    cuentas: articulos.map((a) => (idsCuenta.has(a?.cuentaCosto) ? a.cuentaCosto : null))
  };
}

/**
 * "Gasolina · Calle 11 · 10 de octubre", para decirlo en el chat; '' si no hay nada.
 * @param {{ cuentas?: Array<string|null>, idPdvPropuesto?: string|null, fechaGasto?: string|null }} propuesta
 * @param {{ cuentas: Array<{id: string, nombre: string}>, pdvs: Array<{id: string, nombre: string}> }|null} catalogo
 */
export function textoDePropuesta({ cuentas = [], idPdvPropuesto = null, fechaGasto = null }, catalogo) {
  const nombre = (id) => catalogo?.cuentas.find((c) => c.id === id)?.nombre || id;
  const unicas = [...new Set(cuentas.filter(Boolean))].map(nombre);
  const partes = [];
  if (unicas.length) partes.push(unicas.join(', '));
  if (idPdvPropuesto) partes.push(catalogo?.pdvs.find((p) => p.id === idPdvPropuesto)?.nombre || idPdvPropuesto);
  if (fechaGasto) {
    const [y, m, d] = fechaGasto.split('-').map(Number);
    partes.push(new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', timeZone: 'UTC' }));
  }
  return partes.join(' · ');
}
