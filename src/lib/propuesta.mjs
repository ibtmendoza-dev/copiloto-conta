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
//
// EL TIPO DE GASTO (2026-10-12, incremento 9 de Costos operativos). La IA
// elige para cada artículo un tipo de la misma lista que usa la caja de las
// sucursales (`tipos_gasto`) más la del Copiloto (`tipos_gasto_copiloto`). El
// tipo ya dice a qué cuenta va: en la plataforma, lo que ninguna regla de
// Dirección reconoce lo decide el tipo, y cuenta como clasificado (decisión
// del usuario). Si ninguno le queda, la IA pone un nombre para uno nuevo: se
// crea sin cuenta, con la que sugiere, y Dirección se la da una vez. Sin
// tipos en la base (nadie corrió lps-platform/scripts/sembrar-tipos-gasto.js)
// no se elige ninguno: la captura sigue como antes.

export const NINGUNA = 'ninguna';
export const NUEVO = 'nuevo';

/** Las dos colecciones de tipos que lee la IA, y dónde se guardan los que crea. */
export const COLECCIONES_TIPOS = ['tipos_gasto', 'tipos_gasto_copiloto'];
export const COLECCION_TIPOS_COPILOTO = 'tipos_gasto_copiloto';

// Igual que nombreComparable e idDeIngrediente de lps-platform
// (IngredienteService): el id de un tipo es su nombre sin acentos ni
// mayúsculas. Si se calculara distinto, "Renta de cocina" creado aquí y allá
// serían dos tipos.
const comparable = (texto) => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const idDeTipo = (nombre) => comparable(nombre).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'o', 'con', 'para', 'por', 'en', 'a', 'al', 'un', 'una']);
const GENERICAS = new Set(['otro', 'otros', 'otra', 'otras', 'varios', 'varias', 'gasto', 'gastos', 'cosa', 'cosas', 'compra', 'compras', 'pago', 'pagos', 'insumo', 'insumos', 'producto', 'productos', 'articulo', 'articulos']);

/**
 * El nombre que la IA propuso para un tipo nuevo, limpio; null si está vacío,
 * es muy largo o no dice qué es ("Otros gastos", "Insumo / Producto").
 */
export function nombreDeTipoNuevo(texto) {
  const limpio = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!limpio || limpio.length > 40) return null;
  const palabras = comparable(limpio).replace(/[^a-z0-9]+/g, ' ').split(' ').filter((x) => x.length >= 2 && !VACIAS.has(x));
  if (palabras.length === 0 || palabras.every((x) => GENERICAS.has(x))) return null;
  return limpio.charAt(0).toLocaleUpperCase('es') + limpio.slice(1);
}

/** La fecha de hoy en la Ciudad de México, 'AAAA-MM-DD'. */
export function hoyEnMexico(ahora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ahora);
  const v = (t) => partes.find((p) => p.type === t)?.value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}

/**
 * Lo que la IA necesita del catálogo de la plataforma: las cuentas activas,
 * las sucursales y los tipos de gasto que están en la lista. Lee documentos de
 * `cuentas_costo`, `puntos_venta` y las dos colecciones de tipos (un tipo sin
 * nombre es una corrección de Dirección a uno que no se sembró: se omite).
 */
export function catalogoDePropuesta(cuentas = [], pdvs = [], tipos = []) {
  return {
    tipos: tipos
      .filter((t) => t && t.id && t.nombre && t.activa !== false)
      .map((t) => ({ id: t.id, nombre: String(t.nombre), ayuda: t.ayuda || '', cuentaId: t.cuentaId || null }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
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

/** Si hay tipos de dónde elegir. Sin ellos, no se elige ni se crea ninguno. */
export const hayTipos = (catalogo) => hayCatalogo(catalogo) && Array.isArray(catalogo.tipos) && catalogo.tipos.length > 0;

/**
 * El texto que va en la instrucción a la IA. Dice qué cuentas existen, qué
 * sucursales, y cómo decidir la fecha, con la fecha de hoy para entender
 * "ayer" o "el viernes".
 */
export function instruccionDePropuesta(catalogo, hoy) {
  const cuentas = catalogo.cuentas.map((c) => `- ${c.id}: ${c.nombre}${c.nota ? ` (${c.nota})` : ''}`).join('\n');
  const pdvs = catalogo.pdvs.map((p) => `- ${p.id}: ${p.nombre}`).join('\n');
  const nombreCuenta = (id) => catalogo.cuentas.find((c) => c.id === id)?.nombre;
  const tipos = (catalogo.tipos || []).map((t) => `- ${t.id}: ${t.nombre}${t.ayuda ? ` (${t.ayuda})` : ''}${nombreCuenta(t.cuentaId) ? ` → ${nombreCuenta(t.cuentaId)}` : ''}`).join('\n');
  const instruccionTipos = hayTipos(catalogo) ? `
      - En cada artículo, 'tipoGasto' es el id del TIPO DE GASTO, de esta lista; el tipo ya dice a qué cuenta va. Elige el que mejor le quede:
${tipos}
      - Si ninguno le queda, pon "${NUEVO}" en 'tipoGasto' y escribe en 'tipoNuevo' un nombre corto y general, de una a tres palabras, que sirva para todos los gastos de esa clase ("Renta de cocina", "Luz de sucursal", "Gas de cocina"), no la descripción del ticket. Antes, revisa que no exista ya con otro nombre. En 'cuentaCosto' pon la cuenta que le sugieres a ese tipo nuevo.
      - En PERSONAL, 'tipoGasto' es "${NINGUNA}".` : '';
  return `
      CLASIFICACIÓN PARA COSTOS (solo movimientos del NEGOCIO; en PERSONAL usa "${NINGUNA}" y deja la fecha vacía):
      - En cada artículo, 'cuentaCosto' es el id de la cuenta de costo a la que va, de esta lista. Si ninguna le queda clara, "${NINGUNA}". No inventes ids.
${cuentas}
      - Los ingredientes y empaques de las recetas van a 'alimentos' o a 'empaque-y-desechables-de-producto'. Bolsas, servilletas y tenedores que se entregan al vender van a 'desechables-de-venta'.${instruccionTipos}
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
 * El tipo de cada artículo (2026-10-12): uno de la lista, por su id; o uno
 * nuevo con nombre que diga algo, que si ya existe con ese nombre es ese. Lo
 * nuevo lleva la cuenta que sugirió la IA, si existe.
 *
 * @param {{ contexto: string, sucursal?: string, fechaGasto?: string, articulos: Array<{ cuentaCosto?: string, tipoGasto?: string, tipoNuevo?: string }> }} mov
 * @returns {{ idPdvPropuesto: string|null, fechaGasto: string|null, cuentas: Array<string|null>, tipos: Array<{ id: string, nuevo?: { nombre: string, cuentaSugerida: string|null } }|null> }}
 */
export function normalizarPropuesta(mov, catalogo, hoy) {
  const articulos = Array.isArray(mov?.articulos) ? mov.articulos : [];
  if (!hayCatalogo(catalogo) || mov?.contexto !== 'NEGOCIO') {
    return { idPdvPropuesto: null, fechaGasto: null, cuentas: articulos.map(() => null), tipos: articulos.map(() => null) };
  }
  const idsCuenta = new Set(catalogo.cuentas.map((c) => c.id));
  const idsPdv = new Set(catalogo.pdvs.map((p) => p.id));
  const fecha = String(mov.fechaGasto || '').trim();
  const fechaValida = FECHA.test(fecha) && !Number.isNaN(Date.parse(`${fecha}T12:00:00Z`)) && fecha <= hoy && diasEntre(fecha, hoy) <= 366;
  return {
    idPdvPropuesto: idsPdv.has(mov.sucursal) ? mov.sucursal : null,
    fechaGasto: fechaValida ? fecha : null,
    cuentas: articulos.map((a) => (idsCuenta.has(a?.cuentaCosto) ? a.cuentaCosto : null)),
    tipos: articulos.map((a) => tipoDeArticulo(a, catalogo, idsCuenta))
  };
}

function tipoDeArticulo(articulo, catalogo, idsCuenta) {
  if (!hayTipos(catalogo)) return null;
  const elegido = catalogo.tipos.find((t) => t.id === articulo?.tipoGasto);
  if (elegido) return { id: elegido.id };
  if (articulo?.tipoGasto !== NUEVO) return null;
  const nombre = nombreDeTipoNuevo(articulo.tipoNuevo);
  if (!nombre) return null;
  const id = idDeTipo(nombre);
  const existente = catalogo.tipos.find((t) => comparable(t.nombre) === comparable(nombre) || t.id === id);
  if (existente) return { id: existente.id };
  return { id, nuevo: { nombre, cuentaSugerida: idsCuenta.has(articulo.cuentaCosto) ? articulo.cuentaCosto : null } };
}

/**
 * El documento de un tipo nuevo para `tipos_gasto_copiloto`: sin cuenta, con
 * la que sugirió la IA, a nombre de quien capturó.
 * @param {{ nombre: string, cuentaSugerida?: string|null }} tipo
 * @param {{ usuarioId?: string|null, ahora?: Date }} [opciones]
 */
export function datosDeTipoNuevo({ nombre, cuentaSugerida = null }, { usuarioId = null, ahora = new Date() } = {}) {
  return { nombre, cuentaId: null, cuentaSugerida, activa: true, origen: 'copiloto', creadoPor: usuarioId, creadoEn: ahora.toISOString() };
}

/**
 * "Gasolina o transporte · Calle 11 · 10 de octubre", para decirlo en el chat;
 * '' si no hay nada. Dice los tipos; sin tipos, las cuentas, como antes.
 * @param {{ cuentas?: Array<string|null>, tipos?: Array<Object|null>, idPdvPropuesto?: string|null, fechaGasto?: string|null }} propuesta
 * @param {{ cuentas: Array<{id: string, nombre: string}>, pdvs: Array<{id: string, nombre: string}> }|null} catalogo
 */
export function textoDePropuesta({ cuentas = [], tipos = [], idPdvPropuesto = null, fechaGasto = null }, catalogo) {
  const nombre = (id) => catalogo?.cuentas.find((c) => c.id === id)?.nombre || id;
  const nombreTipo = (t) => (t.nuevo ? `«${t.nuevo.nombre}» (tipo nuevo, falta su cuenta)` : catalogo?.tipos?.find((x) => x.id === t.id)?.nombre || t.id);
  const conTipo = (tipos || []).filter(Boolean);
  const unicas = conTipo.length ? [...new Set(conTipo.map(nombreTipo))] : [...new Set(cuentas.filter(Boolean))].map(nombre);
  const partes = [];
  if (unicas.length) partes.push(unicas.join(', '));
  if (idPdvPropuesto) partes.push(catalogo?.pdvs.find((p) => p.id === idPdvPropuesto)?.nombre || idPdvPropuesto);
  if (fechaGasto) {
    const [y, m, d] = fechaGasto.split('-').map(Number);
    partes.push(new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', timeZone: 'UTC' }));
  }
  return partes.join(' · ');
}
