// Pruebas de la pregunta por el detalle (detalle.ts). Puras: sin base ni IA.
import { describe, it, expect } from 'vitest';
import { esNombreGenerico, articulosSinIdentificar, preguntaPorDetalle, type MovimientoExtraido } from './detalle';

// El caso real del 22-sep: foto sin texto, la IA no supo qué era.
const camaron: MovimientoExtraido = {
  tipo: 'GASTO',
  importe: 3300,
  articulos: [{ cantidad: 110, descripcion: 'Insumo / Producto', precioUnitario: 30, importeTotal: 3300, identificado: true }]
};

describe('esNombreGenerico', () => {
  it('lo que no dice qué es: el del 22-sep, vacío, o solo palabras genéricas', () => {
    for (const n of ['Insumo / Producto', 'Producto', 'VARIOS', 'Artículos varios', 'Producto sin descripción', 'Mercancía', '', '  ', 'N/A']) {
      expect(esNombreGenerico(n), n).toBe(true);
    }
  });

  it('basta una palabra que diga algo', () => {
    for (const n of ['Camarón pacotilla', 'Insumo de limpieza', 'PAN', 'HARINA ESPIGA 25 KG', 'Propina', 'cebollín', '2212-22 DOMO TRANSPARENTE INIX']) {
      expect(esNombreGenerico(n), n).toBe(false);
    }
  });
});

describe('articulosSinIdentificar', () => {
  it('el nombre genérico pide detalle aunque la IA diga que lo identificó', () => {
    expect(articulosSinIdentificar([camaron])).toEqual([{ contraparte: null, importe: 3300, articulo: camaron.articulos![0] }]);
  });

  it('lo que la IA no identificó pide detalle aunque tenga nombre', () => {
    const mov = { tipo: 'GASTO', importe: 50, contraparte: 'Tlaquepaque', articulos: [{ cantidad: 1, descripcion: 'Pan', precioUnitario: 50, importeTotal: 50, identificado: false }] };
    expect(articulosSinIdentificar([mov])).toHaveLength(1);
    expect(articulosSinIdentificar([mov])[0].contraparte).toBe('Tlaquepaque');
  });

  it('solo los artículos que faltan, de todos los movimientos', () => {
    const mixto = { tipo: 'GASTO', importe: 3500, articulos: [
      { cantidad: 1, descripcion: 'Fresa', precioUnitario: 200, importeTotal: 200, identificado: true },
      { cantidad: 110, descripcion: 'Producto', precioUnitario: 30, importeTotal: 3300 }
    ] };
    expect(articulosSinIdentificar([mixto, camaron]).map((f) => f.articulo?.importeTotal)).toEqual([3300, 3300]);
  });

  it('un gasto sin artículos pide detalle; una venta sin artículos no', () => {
    expect(articulosSinIdentificar([{ tipo: 'GASTO', importe: 120, articulos: [] }])).toEqual([{ contraparte: null, importe: 120, articulo: null }]);
    expect(articulosSinIdentificar([{ tipo: 'gasto', importe: 120 }])).toHaveLength(1);
    expect(articulosSinIdentificar([{ tipo: 'VENTA', importe: 5000, articulos: [] }])).toEqual([]);
  });

  it('lo identificado y con nombre pasa', () => {
    const bueno = { tipo: 'GASTO', importe: 3300, contraparte: 'El Güero Gil', articulos: [{ cantidad: 30, descripcion: 'Camarón pacotilla', precioUnitario: 110, importeTotal: 3300, identificado: true }] };
    expect(articulosSinIdentificar([bueno])).toEqual([]);
    expect(articulosSinIdentificar([])).toEqual([]);
  });
});

describe('preguntaPorDetalle', () => {
  it('enseña lo que se alcanzó a leer, sin el nombre genérico, y dice que no se registró nada', () => {
    const p = preguntaPorDetalle(articulosSinIdentificar([camaron]), { conImagen: true });
    expect(p).toContain('en el ticket');
    expect(p).toContain('110 × $30.00 = $3,300.00');
    expect(p).not.toContain('Insumo / Producto');
    expect(p).toContain('La foto sigue adjunta');
    expect(p).toContain('Todavía no registré nada.');
  });

  it('con nombre no genérico lo cita, con la tienda si se leyó', () => {
    const p = preguntaPorDetalle([{ contraparte: 'Tlaquepaque', importe: 50, articulo: { cantidad: 1, descripcion: 'Pan dulce', precioUnitario: 50, importeTotal: 50 } }]);
    expect(p).toContain('«Pan dulce»: 1 × $50.00 = $50.00 en Tlaquepaque');
    expect(p).toContain('en tu mensaje');
    expect(p).not.toContain('La foto sigue adjunta');
  });

  it('un gasto sin artículos se nombra por su importe', () => {
    expect(preguntaPorDetalle([{ contraparte: 'Zafra', importe: 822, articulo: null }])).toContain('- Un gasto de $822.00 en Zafra');
  });
});
