// El libro de dinero: cuentas, asientos y saldos.
// Ver docs/DISENO-libro-de-dinero.md en el repositorio de la plataforma.
//
// Todo lo que escribe en el libro pasa por `crearAsiento`. No hay otra puerta,
// y es a proposito: las invariantes solo valen si no se pueden esquivar.

import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma';

export const TIPOS_CUENTA = ['ACTIVO', 'PASIVO', 'INGRESO', 'GASTO', 'CAPITAL'] as const;
export const ORIGENES = ['COPILOTO', 'CONCILIACION', 'MANUAL'] as const;
export const ESTADOS = ['PROPUESTO', 'FIRME'] as const;

export type TipoCuenta = (typeof TIPOS_CUENTA)[number];
export type Origen = (typeof ORIGENES)[number];
export type Estado = (typeof ESTADOS)[number];

/** Un lado del asiento, tal como lo escribe quien llama. */
export interface ApunteEntrada {
  cuentaId: string;
  debe?: Prisma.Decimal | number | string;
  haber?: Prisma.Decimal | number | string;
}

export interface AsientoEntrada {
  contribuyenteId: string;
  fechaOcurrencia: Date;
  descripcion: string;
  origen: Origen;
  referenciaOrigen?: string | null;
  estado?: Estado;
  apuntes: ApunteEntrada[];
}

/** Se lanza cuando el asiento no cumple alguna invariante. Nunca se traga. */
export class AsientoInvalido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'AsientoInvalido';
  }
}

const CERO = new Prisma.Decimal(0);

function aDecimal(valor: Prisma.Decimal | number | string | undefined): Prisma.Decimal {
  if (valor === undefined || valor === null || valor === '') return CERO;
  try {
    return new Prisma.Decimal(valor as any);
  } catch {
    throw new AsientoInvalido(`Importe no numerico: ${String(valor)}`);
  }
}

/**
 * La validacion, sin base de datos de por medio.
 *
 * Es una funcion pura a proposito: las invariantes del libro son la parte que
 * mas importa y la que mas barato sale probar exhaustivamente si no necesita
 * una base levantada. `crearAsiento` la llama antes de escribir nada.
 *
 * Devuelve los apuntes normalizados a Decimal, listos para persistir.
 */
export function validarAsiento(entrada: AsientoEntrada): { debe: Prisma.Decimal; haber: Prisma.Decimal; cuentaId: string }[] {
  if (!entrada.contribuyenteId) throw new AsientoInvalido('Falta el contribuyente.');
  if (!entrada.descripcion || !entrada.descripcion.trim()) {
    throw new AsientoInvalido('Un asiento sin descripcion no se puede interpretar despues.');
  }
  if (!(entrada.fechaOcurrencia instanceof Date) || Number.isNaN(entrada.fechaOcurrencia.getTime())) {
    throw new AsientoInvalido('La fecha de ocurrencia no es una fecha valida.');
  }
  if (!ORIGENES.includes(entrada.origen)) {
    throw new AsientoInvalido(`Origen desconocido: ${entrada.origen}`);
  }
  if (entrada.estado && !ESTADOS.includes(entrada.estado)) {
    throw new AsientoInvalido(`Estado desconocido: ${entrada.estado}`);
  }

  // Un asiento de un solo lado es exactamente el problema que este modelo
  // viene a resolver: dice cuanto, no de donde. Se rechaza.
  if (!Array.isArray(entrada.apuntes) || entrada.apuntes.length < 2) {
    throw new AsientoInvalido('Un asiento necesita al menos dos apuntes: de donde sale y a donde entra.');
  }

  const normalizados = entrada.apuntes.map((a, i) => {
    if (!a.cuentaId) throw new AsientoInvalido(`El apunte ${i + 1} no indica cuenta.`);

    const debe = aDecimal(a.debe);
    const haber = aDecimal(a.haber);

    if (debe.isNegative() || haber.isNegative()) {
      throw new AsientoInvalido(`El apunte ${i + 1} tiene un importe negativo. El sentido lo da el lado, no el signo.`);
    }
    if (debe.isZero() && haber.isZero()) {
      throw new AsientoInvalido(`El apunte ${i + 1} no mueve nada.`);
    }
    if (!debe.isZero() && !haber.isZero()) {
      throw new AsientoInvalido(`El apunte ${i + 1} carga y abona a la vez. Deben ser dos apuntes.`);
    }

    // Dos decimales: mas alla no es dinero, y un tercer decimal escondido hace
    // que un asiento parezca cuadrado en pantalla sin estarlo.
    if (debe.decimalPlaces() > 2 || haber.decimalPlaces() > 2) {
      throw new AsientoInvalido(`El apunte ${i + 1} tiene mas de dos decimales.`);
    }

    return { cuentaId: a.cuentaId, debe, haber };
  });

  const sumaDebe = normalizados.reduce((acc, a) => acc.plus(a.debe), CERO);
  const sumaHaber = normalizados.reduce((acc, a) => acc.plus(a.haber), CERO);

  // LA INVARIANTE. Comparar Decimales, nunca numeros: con flotantes,
  // 0.1 + 0.2 no es 0.3 y este asiento se rechazaria sin motivo.
  if (!sumaDebe.equals(sumaHaber)) {
    throw new AsientoInvalido(
      `El asiento no cuadra: debe ${sumaDebe.toFixed(2)} contra haber ${sumaHaber.toFixed(2)}. ` +
      `Diferencia de ${sumaDebe.minus(sumaHaber).toFixed(2)}.`
    );
  }
  if (sumaDebe.isZero()) {
    throw new AsientoInvalido('El asiento suma cero por ambos lados: no registra ningun hecho.');
  }

  return normalizados;
}

/**
 * Crea un asiento. Valida primero, escribe despues, y todo dentro de una sola
 * transaccion: o entra el asiento entero con sus apuntes, o no entra nada. Un
 * asiento a medias seria un descuadre permanente.
 *
 * Si ya existe un asiento con el mismo (origen, referenciaOrigen), NO crea uno
 * nuevo: devuelve el que ya estaba. Reenviar un cierre de turno tiene que ser
 * inofensivo (invariante 4).
 */
export async function crearAsiento(entrada: AsientoEntrada, cliente: PrismaClient = prisma) {
  const apuntes = validarAsiento(entrada);

  if (entrada.referenciaOrigen) {
    const yaExiste = await cliente.asiento.findUnique({
      where: { origen_referenciaOrigen: { origen: entrada.origen, referenciaOrigen: entrada.referenciaOrigen } },
      include: { apuntes: true }
    });
    if (yaExiste) return yaExiste;
  }

  // Las cuentas tienen que existir. Sin esto, un identificador equivocado
  // crearia un apunte que no aparece en el saldo de ninguna cuenta y el libro
  // dejaria de cuadrar sin que nadie lo note.
  const cuentaIds = [...new Set(apuntes.map((a) => a.cuentaId))];
  const encontradas = await cliente.cuenta.findMany({ where: { id: { in: cuentaIds } }, select: { id: true, activa: true } });
  if (encontradas.length !== cuentaIds.length) {
    const faltan = cuentaIds.filter((id) => !encontradas.some((c) => c.id === id));
    throw new AsientoInvalido(`Estas cuentas no existen: ${faltan.join(', ')}`);
  }
  const inactivas = encontradas.filter((c) => !c.activa).map((c) => c.id);
  if (inactivas.length) {
    throw new AsientoInvalido(`No se puede asentar contra cuentas dadas de baja: ${inactivas.join(', ')}`);
  }

  return cliente.$transaction(async (tx) => {
    return tx.asiento.create({
      data: {
        contribuyenteId: entrada.contribuyenteId,
        fechaOcurrencia: entrada.fechaOcurrencia,
        descripcion: entrada.descripcion.trim(),
        origen: entrada.origen,
        referenciaOrigen: entrada.referenciaOrigen ?? null,
        estado: entrada.estado ?? 'PROPUESTO',
        apuntes: { create: apuntes.map((a) => ({ cuentaId: a.cuentaId, debe: a.debe, haber: a.haber })) }
      },
      include: { apuntes: true }
    });
  });
}

/**
 * Saldo de una cuenta: se CALCULA sumando apuntes, nunca se lee de un campo
 * guardado (invariante 3). Un contador acumulado es donde nace el dinero que
 * no cuadra: basta un fallo a mitad de camino para que discrepe de los
 * asientos y nadie se entere.
 *
 * Solo cuentan los asientos FIRME. Los PROPUESTO son importes que dedujo la
 * inteligencia artificial y que nadie ha confirmado todavia.
 */
export async function saldoDeCuenta(cuentaId: string, hasta?: Date, cliente: PrismaClient = prisma) {
  const apuntes = await cliente.apunte.findMany({
    where: {
      cuentaId,
      asiento: {
        estado: 'FIRME',
        ...(hasta ? { fechaOcurrencia: { lte: hasta } } : {})
      }
    },
    select: { debe: true, haber: true }
  });

  return apuntes.reduce(
    (acc, a) => acc.plus(a.debe).minus(a.haber),
    new Prisma.Decimal(0)
  );
}

/**
 * Busca asientos descuadrados. No deberia encontrar ninguno nunca: si aparece
 * uno, algo escribio saltandose `crearAsiento`. Conviene ejecutarlo de vez en
 * cuando -- es la unica forma de enterarse.
 */
export async function asientosDescuadrados(cliente: PrismaClient = prisma) {
  const asientos = await cliente.asiento.findMany({ include: { apuntes: true } });
  return asientos
    .map((a) => {
      const debe = a.apuntes.reduce((acc, p) => acc.plus(p.debe), new Prisma.Decimal(0));
      const haber = a.apuntes.reduce((acc, p) => acc.plus(p.haber), new Prisma.Decimal(0));
      return { id: a.id, descripcion: a.descripcion, debe, haber, diferencia: debe.minus(haber) };
    })
    .filter((a) => !a.diferencia.isZero());
}
