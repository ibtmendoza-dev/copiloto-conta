// Cuando el ticket no dice qué se compró, se le pregunta al usuario
// (2026-10-12).
//
// POR QUÉ. El 22 de septiembre llegó la foto de un ticket sin texto. La IA
// leyó "110 × $30 = $3,300" y, sin saber qué era, escribió "Insumo / Producto".
// Era camarón pacotilla: 30 bolsas a $110, con la cantidad y el precio
// cruzados. Se guardó así, cruzó al almacén y a Costos de la plataforma, y
// allá nadie podía saber qué era sin buscar la foto en Vercel.
//
// QUÉ HACE. Si algún artículo no se identifica —la IA lo dice, o su nombre es
// genérico— la acción no guarda nada: devuelve una pregunta, y la pantalla
// deja la foto adjunta para que la respuesta viaje con ella. No hay salida
// para guardarlo sin detalle: es lo que pidió el usuario.
//
// El nombre genérico se revisa aquí aunque la IA diga que lo identificó: el
// 22-sep la IA no dudó. Todo es puro; probado en detalle.test.ts.

/** Palabras que, solas, no dicen qué se compró. */
const PALABRAS_GENERICAS = new Set([
  'insumo', 'insumos', 'producto', 'productos', 'articulo', 'articulos',
  'mercancia', 'mercancias', 'material', 'materiales', 'concepto', 'conceptos',
  'compra', 'compras', 'varios', 'varias', 'otro', 'otros', 'item', 'items',
  'desconocido', 'generico', 'sin', 'descripcion', 'nombre', 'de', 'y', 'o', 'n', 'a', 'na'
]);

const palabras = (texto: string) => String(texto || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter(Boolean);

/**
 * Si el nombre no dice qué es: vacío, o hecho solo de palabras genéricas
 * ("Insumo / Producto", "Varios", "Producto sin descripción"). Basta una
 * palabra que diga algo para que no lo sea ("insumo de limpieza").
 */
export function esNombreGenerico(descripcion: string): boolean {
  const lista = palabras(descripcion);
  return lista.length === 0 || lista.every((p) => PALABRAS_GENERICAS.has(p));
}

export type ArticuloExtraido = {
  cantidad: number
  descripcion: string
  precioUnitario: number
  importeTotal: number
  identificado?: boolean
}

export type MovimientoExtraido = {
  tipo: string
  importe: number
  contraparte?: string
  articulos?: ArticuloExtraido[]
}

export type Faltante = {
  contraparte: string | null
  importe: number
  // null: el gasto no trae ningún artículo.
  articulo: ArticuloExtraido | null
}

/**
 * Lo que no se sabe qué es: cada artículo que la IA no identificó o que tiene
 * nombre genérico, y cada gasto sin artículos. Una venta sin artículos no
 * cuenta: no hay nada que preguntar.
 */
export function articulosSinIdentificar(movimientos: MovimientoExtraido[] = []): Faltante[] {
  const faltan: Faltante[] = [];
  for (const mov of movimientos) {
    const contraparte = mov.contraparte?.trim() || null;
    const articulos = mov.articulos || [];
    if (articulos.length === 0) {
      if (String(mov.tipo || '').toUpperCase() === 'GASTO') faltan.push({ contraparte, importe: mov.importe, articulo: null });
      continue;
    }
    for (const art of articulos) {
      if (art.identificado === false || esNombreGenerico(art.descripcion)) faltan.push({ contraparte, importe: mov.importe, articulo: art });
    }
  }
  return faltan;
}

const pesos = (n: number) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const numero = (n: number) => Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 3 });

/**
 * La pregunta para el usuario: qué se ve de cada cosa que falta (cantidad,
 * precio, importe, tienda) y qué tiene que decir. Deja claro que no se
 * registró nada.
 */
export function preguntaPorDetalle(faltan: Faltante[], { conImagen = false } = {}): string {
  const donde = conImagen ? 'en el ticket' : 'en tu mensaje';
  const lineas = faltan.map((f) => {
    const tienda = f.contraparte ? ` en ${f.contraparte}` : '';
    if (!f.articulo) return `- Un gasto de ${pesos(f.importe)}${tienda}`;
    const a = f.articulo;
    const nombre = esNombreGenerico(a.descripcion) ? '' : `«${a.descripcion.trim()}»: `;
    return `- ${nombre}${numero(a.cantidad)} × ${pesos(a.precioUnitario)} = ${pesos(a.importeTotal)}${tienda}`;
  });
  return `No alcanzo a saber ${donde} qué compraste:\n${lineas.join('\n')}\n\n`
    + 'Dime qué es, cuántos y a cuánto. Por ejemplo: «30 bolsas de camarón pacotilla a $110».\n'
    + (conImagen ? 'La foto sigue adjunta: escribe tu respuesta y envía. ' : '')
    + 'Todavía no registré nada.';
}
