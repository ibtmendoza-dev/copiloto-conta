// La comisión de entrega del proveedor de verduras va dentro del precio de
// cada paquete (2026-10-19).
//
// POR QUÉ. El proveedor de verduras manda su cuenta por WhatsApp: un renglón
// por verdura ("2 de zanahoria 200") y luego una suma que trae un monto sin
// nombre ("200+150+150+150+150+300=1100"). Ese monto es su comisión por
// entregar, y va por bulto o caja: en los mensajes del 30-sep, 7-oct y 14-oct
// sale exacto a $50 por paquete, y la cebolla, que se compra por kilo, no la
// paga.
//
// La plataforma toma el costo de cada ingrediente de su última compra. Si la
// comisión cruzara como un renglón aparte, cada captura bajaría el costo de las
// verduras al precio sin entrega. Por eso se reparte en el precio de cada
// paquete antes de guardar, y el renglón de la comisión desaparece: el importe
// del movimiento no cambia.
//
// SOLO VERDURAS (decisión del usuario): se reparte únicamente cuando todo lo
// demás del movimiento son verduras. Cualquier otro envío, flete o comisión se
// queda como está. Todo es puro; probado en verduras.test.ts.

/** Lo que va en el prompt de extracción, después de las reglas de insumo. */
export const REGLAS_VERDURAS = `COMPRAS AL PROVEEDOR DE VERDURAS (casi siempre una captura de sus mensajes de WhatsApp):
      - Cada renglón "N de VERDURA IMPORTE" (por ejemplo "2 de zanahoria 200") son N paquetes (bultos o cajas) de esa verdura por IMPORTE en total: 'cantidad' = N, 'importeTotal' = IMPORTE, 'precioUnitario' = IMPORTE / N, 'porPeso' = false.
      - "20 kilos de cebolla 800" son 20 kg por 800: 'cantidad' = 20, 'porPeso' = true. La cebolla de este proveedor siempre es por kilo aunque no lo diga ("15 de cebolla 600" son 15 kg).
      - 'descripcion' es solo el nombre de la verdura, en singular y con mayúscula inicial, sin cantidad ni unidad: "Zanahoria", "Pepino", "Calabaza", "Morrón", "Cebolla", "Limón".
      - Después viene una suma ("200+150+150+150+150+300=1100") o un total ("Total: 1950"). El importe del movimiento es ese total. El monto de la suma que no corresponde a ningún renglón es la comisión que cobra el proveedor por la entrega: agrégala como un artículo más, con 'descripcion' = "Comisión de entrega", 'cantidad' = 1, 'cargoDeEntrega' = true, 'identificado' = true y 'esInsumo' = false.
      - Las verduras van con 'esVerdura' = true y 'esInsumo' = true; la categoría es INVENTARIO y la contraparte "Proveedor de verduras".
      - La fecha de la burbuja de WhatsApp va día/mes/año ("7/10/2026" es el 7 de octubre de 2026). Si dice un día de la semana, "Hoy" o "Ayer", deja 'fechaGasto' vacío.
      - Si la captura trae pedidos de días distintos, cada uno es un movimiento con su propio total. Ignora saludos, agradecimientos, mensajes borrados y stickers.
      REGLAS PARA 'esVerdura' Y 'cargoDeEntrega' EN CUALQUIER CAPTURA:
      - 'esVerdura' = true solo para verduras frescas de verdulería (zanahoria, pepino, calabaza, morrón, cebolla, chiles, limón...). Las frutas (kiwi, fresa, zarzamora, frambuesa, mango) y todo lo demás van con 'esVerdura' = false.
      - 'cargoDeEntrega' = true SOLO para la comisión de entrega de una compra de verduras. Cualquier otro envío, flete o comisión va con 'cargoDeEntrega' = false.`;

export type ArticuloConVerdura = {
  cantidad: number;
  descripcion: string;
  precioUnitario: number;
  importeTotal: number;
  esVerdura?: boolean;
  porPeso?: boolean;
  cargoDeEntrega?: boolean;
};

export type Reparto = {
  comision: number;
  /** 'paquete': lo mismo por cada bulto o caja; 'importe': si todo fue por peso, en proporción al importe. */
  criterio: 'paquete' | 'importe';
  paquetes: number;
  sinComision: string[];
};

const centavos = (v: number) => Math.round((Number(v) || 0) * 100);

/**
 * Reparte `total` centavos en proporción a `pesos`, sin perder ni sobrar
 * un centavo: lo que dejan los redondeos va a los de mayor residuo.
 */
export function repartirCentavos(total: number, pesos: number[]): number[] {
  const suma = pesos.reduce((a, p) => a + p, 0);
  if (!(suma > 0)) return pesos.map(() => 0);
  const exactos = pesos.map((p) => (total * p) / suma);
  const base = exactos.map((e) => Math.floor(e));
  let resto = total - base.reduce((a, b) => a + b, 0);
  const orden = exactos.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of orden) {
    if (resto <= 0) break;
    base[i] += 1;
    resto -= 1;
  }
  return base;
}

/**
 * Si el movimiento es una compra de verduras con comisión de entrega, la
 * reparte en el precio de cada paquete y quita su renglón. Si no, lo devuelve
 * igual y `reparto` es null.
 */
export function repartirComisionDeVerduras<A extends ArticuloConVerdura, M extends { articulos: A[] }>(mov: M): { movimiento: M; reparto: Reparto | null } {
  const articulos = Array.isArray(mov.articulos) ? mov.articulos : [];
  const cargos = articulos.filter((a) => a.cargoDeEntrega === true);
  const verduras = articulos.filter((a) => a.cargoDeEntrega !== true);
  const sinCambio = { movimiento: mov, reparto: null };
  if (cargos.length === 0 || verduras.length === 0) return sinCambio;
  if (!verduras.every((a) => a.esVerdura === true)) return sinCambio;

  const comision = cargos.reduce((s, a) => s + centavos(a.importeTotal), 0);
  if (comision <= 0) return sinCambio;
  const porPaquete = verduras.map((a) => (a.porPeso === true ? 0 : Math.max(0, Number(a.cantidad) || 0)));
  const paquetes = porPaquete.reduce((s, p) => s + p, 0);
  const criterio: Reparto['criterio'] = paquetes > 0 ? 'paquete' : 'importe';
  const pesos = criterio === 'paquete' ? porPaquete : verduras.map((a) => Math.max(0, centavos(a.importeTotal)));
  const partes = repartirCentavos(comision, pesos);
  if (partes.every((p) => p === 0)) return sinCambio;

  const nuevas = verduras.map((a, i) => {
    const importeTotal = (centavos(a.importeTotal) + partes[i]) / 100;
    const cantidad = Number(a.cantidad) || 0;
    const precioUnitario = cantidad > 0 ? Math.round((importeTotal / cantidad) * 10000) / 10000 : a.precioUnitario;
    return { ...a, importeTotal, precioUnitario };
  });
  return {
    movimiento: { ...mov, articulos: nuevas },
    reparto: {
      comision: comision / 100,
      criterio,
      paquetes,
      sinComision: criterio === 'paquete' ? verduras.filter((a) => a.porPeso === true).map((a) => a.descripcion) : []
    }
  };
}

const pesos = (v: number) => `$${v.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Una línea para el chat: qué se hizo con la comisión. */
export function textoDeReparto(r: Reparto | null): string {
  if (!r) return '';
  if (r.criterio === 'importe') return `${pesos(r.comision)} repartidos en el precio de las verduras, en proporción a lo que costó cada una.`;
  const cada = r.comision / r.paquetes;
  const exacto = Math.abs(cada * 100 - Math.round(cada * 100)) < 1e-6;
  const base = `${pesos(r.comision)} repartidos en el precio de ${r.paquetes} paquete${r.paquetes === 1 ? '' : 's'}${exacto ? ` (${pesos(cada)} cada uno)` : ''}`;
  if (r.sinComision.length === 0) return `${base}.`;
  const nombres = r.sinComision.map((n) => n.toLowerCase()).join(', ');
  return `${base}; ${nombres} ${r.sinComision.length === 1 ? 'va por kilo y no la paga' : 'van por kilo y no la pagan'}.`;
}
