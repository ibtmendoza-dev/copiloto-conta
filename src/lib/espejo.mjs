// El espejo del Copiloto en la plataforma de producción (LPS Platform):
// cada movimiento del NEGOCIO, con TODOS sus artículos, en
// `movimientos_finanzas/{id del movimiento}` (2026-10-11).
//
// POR QUÉ EXISTE. El puente de insumos (insumos.ts) solo manda a
// `entradas_almacen` los artículos marcados como insumo. La renta, la luz, el
// gas, la gasolina y el chofer se capturan aquí y nunca llegaban a la
// plataforma, así que la pestaña Costos de Dirección no los veía. El espejo
// manda todo lo del negocio; el puente de insumos se queda como está, porque
// "Costos desde compras" depende de él. La plataforma no cuenta dos veces: deja
// de leer la entrada de almacén de un movimiento que ya está en el espejo, por
// `entradaAlmacenId`.
//
// Contrato completo: lps-platform/docs/PENDIENTE-espejo-copiloto.md. Lo lee
// `renglonesDeMovimiento` de lps-platform/packages/core/src/ClasificacionGastoService.js.
//
// POR QUÉ ES .mjs Y NO .ts. Lo usan la acción del servidor (actions.ts) y el
// guion de relleno (scripts/espejar-movimientos.js), que es JavaScript sin
// compilar. Escrito dos veces acabaría diciendo cosas distintas (la misma
// razón de reglas-insumo.json).
//
// Todo lo de aquí es puro: sin base, sin Firestore, probado en espejo.test.ts.

export const COLECCION_ESPEJO = 'movimientos_finanzas';
export const VERSION_ESPEJO = 1;

/** Los Decimal de Prisma, los textos y los números pasan a número; los nulos se quedan nulos. */
const aNumero = (valor) => (valor === null || valor === undefined ? null : Number(valor));

/** A centavos, para que la plataforma no herede el ruido de los flotantes. */
const aCentavos = (valor) => {
  const n = aNumero(valor);
  return n === null ? null : Number(n.toFixed(2));
};

/**
 * Solo viaja lo del negocio. Lo PERSONAL se queda aquí: dónde vive al unificar
 * las bases se decide aparte.
 *
 * @param {{ contexto?: string | null }} mov
 * @returns {boolean}
 */
export function debeEspejar(mov) {
  return Boolean(mov) && mov.contexto === 'NEGOCIO';
}

/**
 * El documento de `movimientos_finanzas/{mov.id}`. Recibe el movimiento tal
 * como lo devuelve Prisma con `include: { conceptos: true }`.
 *
 * `momento` es el mismo instante que `fechaOcurrencia`, en texto: la plataforma
 * lee "desde" por ese campo. Los importes van a centavos; la cantidad no es
 * dinero y no se redondea (0.125 kg seguiría siendo 0.125).
 *
 * @param {{
 *   id: string,
 *   tipo: string,
 *   categoria?: string | null,
 *   fechaOcurrencia: Date,
 *   importe: unknown,
 *   subtotal?: unknown,
 *   iva?: unknown,
 *   contraparteNombre?: string | null,
 *   descripcionOriginal?: string | null,
 *   estado?: string | null,
 *   usuarioId?: string | null,
 *   entradaAlmacenId?: string | null,
 *   conceptos?: Array<{ id: string, cantidad: unknown, descripcion: string, precioUnitario?: unknown, importeTotal: unknown, esInsumo?: boolean | null }>
 * }} mov
 * @param {Date} ahora - cuándo se escribe
 */
export function payloadMovimientoFinanzas(mov, ahora) {
  const fecha = new Date(mov.fechaOcurrencia);
  const conceptos = Array.isArray(mov.conceptos) ? mov.conceptos : [];
  return {
    movimientoId: mov.id,
    origen: 'copiloto-conta',
    version: VERSION_ESPEJO,
    contexto: 'NEGOCIO',
    tipo: String(mov.tipo || '').toUpperCase(),
    categoria: mov.categoria ?? null,
    fechaOcurrencia: fecha,
    momento: fecha.toISOString(),
    importe: aCentavos(mov.importe),
    subtotal: aCentavos(mov.subtotal),
    iva: aCentavos(mov.iva),
    contraparte: mov.contraparteNombre ?? null,
    descripcionOriginal: mov.descripcionOriginal ?? '',
    estado: mov.estado ?? null,
    usuarioId: mov.usuarioId ?? null,
    entradaAlmacenId: mov.entradaAlmacenId ?? null,
    conceptos: conceptos.map((c) => ({
      id: c.id,
      cantidad: aNumero(c.cantidad),
      descripcion: c.descripcion ?? '',
      precioUnitario: aCentavos(c.precioUnitario),
      importeTotal: aCentavos(c.importeTotal),
      esInsumo: c.esInsumo === true
    })),
    espejadoEn: ahora.toISOString()
  };
}

// ── Cotejo ──────────────────────────────────────────────────────────────────
// Lo que se compara entre Neon y el espejo, para el guion de relleno. Ya pasó
// una vez que algo se borró de un solo lado ($2,780 en compras huérfanas,
// lps-platform/docs/DISENO-libro-de-dinero.md §9): por eso el cotejo va por
// mes y además dice qué movimiento falta, sobra o difiere.

/** El mes en la Ciudad de México ("2026-09"), donde opera el negocio. */
export function mesLocal(fecha) {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date(fecha));
  const valor = (tipo) => partes.find((p) => p.type === tipo)?.value;
  return `${valor('year')}-${valor('month')}`;
}

/** Lo que debe coincidir entre el documento que se escribiría y el que está. */
const huella = (doc) => JSON.stringify({
  importe: doc.importe,
  momento: doc.momento,
  tipo: doc.tipo,
  entradaAlmacenId: doc.entradaAlmacenId ?? null,
  conceptos: (doc.conceptos || []).map((c) => [c.id, c.importeTotal, c.esInsumo === true])
});

/**
 * Compara, por mes, lo que debería estar en el espejo (los payloads de Neon)
 * contra lo que está (los documentos leídos de Firestore).
 *
 * @param {Array<ReturnType<typeof payloadMovimientoFinanzas>>} esperados
 * @param {Array<{ movimientoId: string, momento: string, importe: number, tipo?: string, entradaAlmacenId?: string | null, conceptos?: any[] }>} presentes
 */
export function cotejarEspejo(esperados, presentes) {
  const porId = new Map(presentes.map((d) => [d.movimientoId, d]));
  const idsEsperados = new Set(esperados.map((e) => e.movimientoId));
  const faltan = esperados.filter((e) => !porId.has(e.movimientoId));
  const difieren = esperados.filter((e) => porId.has(e.movimientoId) && huella(porId.get(e.movimientoId)) !== huella(e));
  const sobran = presentes.filter((d) => !idsEsperados.has(d.movimientoId));

  const meses = new Map();
  const fila = (mes) => {
    if (!meses.has(mes)) meses.set(mes, { mes, neon: { movimientos: 0, total: 0 }, espejo: { movimientos: 0, total: 0 } });
    return meses.get(mes);
  };
  esperados.forEach((e) => { const f = fila(mesLocal(e.momento)); f.neon.movimientos += 1; f.neon.total += e.importe || 0; });
  presentes.forEach((d) => { const f = fila(mesLocal(d.momento)); f.espejo.movimientos += 1; f.espejo.total += Number(d.importe) || 0; });
  const porMes = [...meses.values()]
    .map((f) => ({
      ...f,
      neon: { ...f.neon, total: Number(f.neon.total.toFixed(2)) },
      espejo: { ...f.espejo, total: Number(f.espejo.total.toFixed(2)) }
    }))
    .map((f) => ({ ...f, cuadra: f.neon.movimientos === f.espejo.movimientos && f.neon.total === f.espejo.total }))
    .sort((a, b) => a.mes.localeCompare(b.mes));

  return { porMes, faltan, difieren, sobran, cuadra: faltan.length === 0 && difieren.length === 0 && sobran.length === 0 };
}
