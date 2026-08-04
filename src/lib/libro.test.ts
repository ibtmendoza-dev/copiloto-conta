// Pruebas de las invariantes del libro de dinero.
// Ver docs/DISENO-libro-de-dinero.md §3 en el repositorio de la plataforma.
//
// Se prueba `validarAsiento`, que es pura y no necesita base de datos. Esa
// separacion es deliberada: las invariantes son la parte que mas importa del
// libro y la que mas barato sale probar exhaustivamente si no hay que levantar
// PostgreSQL para cada caso. `crearAsiento` no hace mas que llamarla antes de
// escribir, dentro de una transaccion.

import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { validarAsiento, AsientoInvalido, type AsientoEntrada } from './libro';

const CAJA = 'cuenta-caja';
const GASTO = 'cuenta-gasto';
const BANCO = 'cuenta-banco';

function asiento(parcial: Partial<AsientoEntrada> = {}): AsientoEntrada {
  return {
    contribuyenteId: 'tenant-123',
    fechaOcurrencia: new Date('2026-08-04T21:34:32Z'),
    descripcion: 'Compra de cinco cajas de domo',
    origen: 'COPILOTO',
    apuntes: [
      { cuentaId: GASTO, debe: 2500 },
      { cuentaId: CAJA, haber: 2500 }
    ],
    ...parcial
  };
}

describe('validarAsiento — el asiento cuadra (invariante 1)', () => {
  it('acepta un asiento cuadrado de dos apuntes', () => {
    const apuntes = validarAsiento(asiento());
    expect(apuntes).toHaveLength(2);
    expect(apuntes[0].debe.toFixed(2)).toBe('2500.00');
    expect(apuntes[1].haber.toFixed(2)).toBe('2500.00');
  });

  it('acepta un asiento cuadrado de mas de dos apuntes', () => {
    // Una compra pagada mitad en efectivo y mitad con tarjeta.
    const apuntes = validarAsiento(asiento({
      apuntes: [
        { cuentaId: GASTO, debe: 1000 },
        { cuentaId: CAJA, haber: 400 },
        { cuentaId: BANCO, haber: 600 }
      ]
    }));
    expect(apuntes).toHaveLength(3);
  });

  it('rechaza un asiento que no cuadra, y dice de cuanto es la diferencia', () => {
    expect(() => validarAsiento(asiento({
      apuntes: [
        { cuentaId: GASTO, debe: 2500 },
        { cuentaId: CAJA, haber: 2400 }
      ]
    }))).toThrow(/no cuadra.*100\.00/s);
  });

  // El caso que justifica usar Decimal y no numeros. Con flotantes,
  // 0.1 + 0.2 === 0.30000000000000004 y este asiento se rechazaria sin motivo.
  it('cuadra con decimales que en coma flotante no cuadrarian', () => {
    const apuntes = validarAsiento(asiento({
      apuntes: [
        { cuentaId: GASTO, debe: 0.1 },
        { cuentaId: GASTO, debe: 0.2 },
        { cuentaId: CAJA, haber: 0.3 }
      ]
    }));
    expect(apuntes).toHaveLength(3);
  });

  it('acepta importes escritos como texto, que es como llegan de un formulario', () => {
    const apuntes = validarAsiento(asiento({
      apuntes: [
        { cuentaId: GASTO, debe: '408.50' },
        { cuentaId: CAJA, haber: '408.50' }
      ]
    }));
    expect(apuntes[0].debe.toFixed(2)).toBe('408.50');
  });

  it('acepta Decimal de Prisma directamente', () => {
    const apuntes = validarAsiento(asiento({
      apuntes: [
        { cuentaId: GASTO, debe: new Prisma.Decimal('2045.50') },
        { cuentaId: CAJA, haber: new Prisma.Decimal('2045.50') }
      ]
    }));
    expect(apuntes[0].debe.toFixed(2)).toBe('2045.50');
  });
});

describe('validarAsiento — un hecho tiene dos lados', () => {
  // Es el problema exacto que el modelo `Movimiento` no puede resolver: dice
  // cuanto se gasto, no de donde salio.
  it('rechaza un asiento de un solo apunte', () => {
    expect(() => validarAsiento(asiento({
      apuntes: [{ cuentaId: GASTO, debe: 2500 }]
    }))).toThrow(/al menos dos apuntes/);
  });

  it('rechaza un asiento sin apuntes', () => {
    expect(() => validarAsiento(asiento({ apuntes: [] }))).toThrow(/al menos dos apuntes/);
  });

  it('rechaza un apunte que carga y abona a la vez', () => {
    expect(() => validarAsiento(asiento({
      apuntes: [
        { cuentaId: GASTO, debe: 2500, haber: 100 },
        { cuentaId: CAJA, haber: 2400 }
      ]
    }))).toThrow(/carga y abona a la vez/);
  });

  it('rechaza un apunte que no mueve nada', () => {
    expect(() => validarAsiento(asiento({
      apuntes: [
        { cuentaId: GASTO, debe: 2500 },
        { cuentaId: CAJA, haber: 2500 },
        { cuentaId: BANCO }
      ]
    }))).toThrow(/no mueve nada/);
  });

  it('rechaza un asiento que cuadra en cero por los dos lados', () => {
    expect(() => validarAsiento(asiento({
      apuntes: [
        { cuentaId: GASTO, debe: 0, haber: 0 },
        { cuentaId: CAJA, debe: 0, haber: 0 }
      ]
    }))).toThrow(/no mueve nada|suma cero/);
  });
});

describe('validarAsiento — importes bien formados', () => {
  // El sentido de un apunte lo da el lado en el que esta, no el signo. Un
  // negativo en `debe` seria un abono disfrazado: cuadraria la suma y
  // ensuciaria el saldo de la cuenta.
  it('rechaza importes negativos', () => {
    expect(() => validarAsiento(asiento({
      apuntes: [
        { cuentaId: GASTO, debe: -2500 },
        { cuentaId: CAJA, haber: -2500 }
      ]
    }))).toThrow(/negativo/);
  });

  // Un tercer decimal hace que un asiento parezca cuadrado en pantalla, donde
  // se muestran dos, sin estarlo en la base.
  it('rechaza mas de dos decimales', () => {
    expect(() => validarAsiento(asiento({
      apuntes: [
        { cuentaId: GASTO, debe: '100.005' },
        { cuentaId: CAJA, haber: '100.005' }
      ]
    }))).toThrow(/dos decimales/);
  });

  it('rechaza un importe que no es un numero', () => {
    expect(() => validarAsiento(asiento({
      apuntes: [
        { cuentaId: GASTO, debe: 'dos mil quinientos' },
        { cuentaId: CAJA, haber: 2500 }
      ]
    }))).toThrow(/no numerico/);
  });

  it('rechaza un apunte sin cuenta', () => {
    expect(() => validarAsiento(asiento({
      apuntes: [
        { cuentaId: '', debe: 2500 },
        { cuentaId: CAJA, haber: 2500 }
      ]
    }))).toThrow(/no indica cuenta/);
  });
});

describe('validarAsiento — la cabecera', () => {
  it('rechaza un asiento sin descripcion', () => {
    expect(() => validarAsiento(asiento({ descripcion: '   ' }))).toThrow(/sin descripcion/);
  });

  it('rechaza un contribuyente vacio', () => {
    expect(() => validarAsiento(asiento({ contribuyenteId: '' }))).toThrow(/contribuyente/);
  });

  it('rechaza una fecha invalida', () => {
    expect(() => validarAsiento(asiento({ fechaOcurrencia: new Date('vaya fecha') }))).toThrow(/fecha/);
  });

  it('rechaza un origen desconocido', () => {
    expect(() => validarAsiento(asiento({ origen: 'INVENTADO' as any }))).toThrow(/Origen desconocido/);
  });

  it('rechaza un estado desconocido', () => {
    expect(() => validarAsiento(asiento({ estado: 'CASI' as any }))).toThrow(/Estado desconocido/);
  });

  it('acepta los tres origenes previstos', () => {
    for (const origen of ['COPILOTO', 'CONCILIACION', 'MANUAL'] as const) {
      expect(() => validarAsiento(asiento({ origen }))).not.toThrow();
    }
  });
});

describe('validarAsiento — casos reales del negocio', () => {
  it('una compra de insumos pagada de la caja del punto de venta', () => {
    expect(() => validarAsiento(asiento({
      descripcion: 'Ajinomoto y salsa de soya',
      apuntes: [
        { cuentaId: GASTO, debe: '2045.50' },
        { cuentaId: CAJA, haber: '2045.50' }
      ]
    }))).not.toThrow();
  });

  // El caso de §4.1 del diseño: el dueño paga un gasto del negocio de su
  // bolsillo. El negocio le queda a deber, y eso es un apunte, no una nota.
  it('un gasto del negocio pagado con dinero personal del dueño', () => {
    const apuntes = validarAsiento(asiento({
      descripcion: 'Compra de verduras pagada por Anton',
      apuntes: [
        { cuentaId: GASTO, debe: 280 },
        { cuentaId: 'cuenta-corriente-dueno', haber: 280 }
      ]
    }));
    expect(apuntes[1].haber.toFixed(2)).toBe('280.00');
  });

  // El caso de §5.1: un cierre de caja con faltante perdonado. Sin la
  // contrapartida del faltante el asiento no cuadraria -- que es justo lo que
  // obliga a decidir que paso con ese dinero en vez de dejarlo desaparecer.
  it('un cierre de turno con faltante perdonado', () => {
    expect(() => validarAsiento(asiento({
      descripcion: 'Cierre turno sucursal Centro',
      origen: 'CONCILIACION',
      referenciaOrigen: 'conciliacion-abc123',
      apuntes: [
        { cuentaId: CAJA, debe: 4950 },
        { cuentaId: 'cuenta-faltantes', debe: 50 },
        { cuentaId: 'cuenta-ingresos', haber: 5000 }
      ]
    }))).not.toThrow();
  });

  it('sin la cuenta de faltantes, ese mismo cierre no cuadra', () => {
    expect(() => validarAsiento(asiento({
      origen: 'CONCILIACION',
      apuntes: [
        { cuentaId: CAJA, debe: 4950 },
        { cuentaId: 'cuenta-ingresos', haber: 5000 }
      ]
    }))).toThrow(/no cuadra/);
  });
});

describe('AsientoInvalido', () => {
  it('es un error con nombre propio, para poder distinguirlo al atraparlo', () => {
    try {
      validarAsiento(asiento({ descripcion: '' }));
      expect.unreachable('deberia haber lanzado');
    } catch (e) {
      expect(e).toBeInstanceOf(AsientoInvalido);
      expect((e as Error).name).toBe('AsientoInvalido');
    }
  });
});
