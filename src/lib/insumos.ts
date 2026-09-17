// Qué artículos de un movimiento son INSUMOS del negocio y viajan a la
// plataforma de producción (colección `entradas_almacen` de LPS Platform).
//
// POR QUE EXISTE (2026-09-16). El puente a Firestore dependía de la categoría
// del movimiento entero: solo pasaban los NEGOCIO/INVENTARIO. Pero la
// categoría la decide la IA por movimiento, y en un negocio de comida las
// compras de ingredientes caían casi siempre en ALIMENTOS: el chipotle, el
// aceite de ajonjolí, el vinagre de manzana y el consomé de agosto nunca
// llegaron a la plataforma. Y un ticket de Costco mezcla queso panela con una
// cafetera y leche para la casa: la categoría del movimiento no puede decir
// qué líneas son inventario y cuáles no.
//
// La regla ahora es POR ARTÍCULO: cada concepto lleva `esInsumo`, que la IA
// marca al extraer (ver REGLAS_INSUMO, que va en el prompt) y que un guion
// puede reclasificar. El movimiento se inyecta si es NEGOCIO y tiene al menos
// un artículo insumo, y solo viajan esos artículos. La categoría INVENTARIO
// sigue valiendo como "todo es insumo", para no romper lo capturado antes.
//
// Todo lo de aquí es puro: sin base, sin Firestore, probado en insumos.test.ts.

export type ArticuloExtraido = {
  cantidad: number;
  descripcion: string;
  precioUnitario: number | null;
  importeTotal: number;
  esInsumo?: boolean | null;
};

export type MovimientoParaAlmacen = {
  id?: string;
  contexto: string;
  categoria?: string | null;
  fechaOcurrencia: Date;
  importe: number | string | { toString(): string };
  usuarioId?: string | null;
  conceptos: ArticuloExtraido[];
};

import reglas from './reglas-insumo.json';

/**
 * Texto que va dentro del prompt de extracción. Vive en reglas-insumo.json
 * y no aquí para que el guion de reclasificación (CommonJS) use exactamente
 * las mismas reglas: escritas dos veces acabarían diciendo cosas distintas.
 */
export const REGLAS_INSUMO: string = reglas.REGLAS_INSUMO;

const aNumero = (valor: unknown): number | null =>
  (valor === null || valor === undefined ? null : Number(valor));

/**
 * Los artículos que viajan a la plataforma: los marcados como insumo, y solo
 * ellos. La categoría INVENTARIO ya no es un caso aparte: al capturar, un
 * movimiento INVENTARIO marca todos sus artículos (ver actions.ts), y los
 * capturados antes del 2026-09-16 se marcaron con
 * scripts/marcar-inventario-como-insumo.js. Así la casilla del historial
 * puede quitar la marca a un artículo suelto y el puente le hace caso.
 */
export function articulosParaAlmacen(mov: MovimientoParaAlmacen): ArticuloExtraido[] {
  const todos = Array.isArray(mov.conceptos) ? mov.conceptos : [];
  return todos.filter((a) => a.esInsumo === true);
}

/** Solo movimientos del negocio con algún insumo cruzan el puente. */
export function debeInyectar(mov: MovimientoParaAlmacen): boolean {
  return mov.contexto === 'NEGOCIO' && articulosParaAlmacen(mov).length > 0;
}

/**
 * Qué le toca al puente tras un cambio en el movimiento (una marca de insumo
 * que cambió, por ejemplo), según si ya tiene entrada en la plataforma y si
 * hoy debe tenerla.
 */
export function accionDePuente(mov: MovimientoParaAlmacen & { entradaAlmacenId?: string | null }): 'crear' | 'actualizar' | 'retirar' | 'nada' {
  const tiene = Boolean(mov.entradaAlmacenId);
  const debe = debeInyectar(mov);
  if (debe && !tiene) return 'crear';
  if (debe && tiene) return 'actualizar';
  if (!debe && tiene) return 'retirar';
  return 'nada';
}

/**
 * El documento que se escribe en `entradas_almacen`. Misma forma que antes
 * (fechaOcurrencia, origen, totalGastado, usuarioId, articulos) más la
 * categoría del movimiento, su id en el Copiloto y el importe completo del
 * movimiento cuando solo viaja una parte. `totalGastado` es lo que suman los
 * artículos que viajan, que es lo que la plataforma muestra como gasto en
 * insumos.
 */
export function payloadEntradaAlmacen(mov: MovimientoParaAlmacen, articulos = articulosParaAlmacen(mov)) {
  const totalGastado = articulos.reduce((s, a) => s + (Number(a.importeTotal) || 0), 0);
  return {
    fechaOcurrencia: mov.fechaOcurrencia,
    origen: 'Copiloto Conta (Finanzas)',
    categoria: mov.categoria ?? null,
    movimientoId: mov.id ?? null,
    totalGastado,
    importeMovimiento: aNumero(mov.importe),
    usuarioId: mov.usuarioId ?? null,
    articulos: articulos.map((a) => ({
      cantidad: aNumero(a.cantidad),
      descripcion: a.descripcion ?? null,
      precioUnitario: aNumero(a.precioUnitario),
      importeTotal: aNumero(a.importeTotal)
    }))
  };
}
