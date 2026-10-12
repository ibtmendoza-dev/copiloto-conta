// Liga cada movimiento anterior al 2026-09-16 con la entrada de almacén que
// creó en la plataforma (LPS Platform), guardando su `entradaAlmacenId`.
//
// POR QUÉ (2026-10-11). Hasta el 2026-09-16 el puente de insumos creaba la
// entrada en `entradas_almacen` sin guardar aquí su id, y la entrada tampoco
// guardaba el id del movimiento. Quedaron 37 así. Tres cosas fallan por eso:
//   - El espejo (src/lib/espejo.mjs) lleva el entradaAlmacenId para que la
//     plataforma no cuente dos veces la misma compra; sin él, esas 37 compras
//     saldrían repetidas en Costos.
//   - Cambiar la casilla de insumo de uno de ellos crearía una segunda entrada
//     (accionDePuente ve "no tiene" y dice "crear").
//   - Borrarlo dejaría su entrada huérfana en la plataforma.
//
// CÓMO EMPAREJA. El puente viejo copiaba fechaOcurrencia tal cual, así que la
// entrada y su movimiento tienen el mismo instante, al milisegundo. Solo se
// liga un par si es el único candidato por los dos lados, el movimiento es del
// negocio y trae los mismos artículos. Lo demás se enseña y no se toca.
//
// Solo escribe `entradaAlmacenId` en el Copiloto; la plataforma no se toca.
//
// Uso:
//   GOOGLE_APPLICATION_CREDENTIALS=<llave de Firebase> node --env-file=.env scripts/ligar-entradas-viejas.js
//   CONFIRMAR_BASE=<servidor> GOOGLE_APPLICATION_CREDENTIALS=<llave> node --env-file=.env scripts/ligar-entradas-viejas.js --escribir

const { PrismaClient } = require('@prisma/client');
const { confirmarBaseDeDatos, describirBase } = require('./guardia-base');

const escribir = process.argv.includes('--escribir');

const articulosIguales = (entrada, mov) => {
  const de = (lista) => lista.map((a) => String(a.descripcion ?? '')).sort().join('\n');
  return de(entrada.articulos || []) === de(mov.conceptos);
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL. Uso: node --env-file=.env scripts/ligar-entradas-viejas.js');
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Hace falta GOOGLE_APPLICATION_CREDENTIALS con la llave de Firebase, para leer las entradas de almacén.');
  const base = describirBase(process.env.DATABASE_URL);
  console.log(`Escribiría en el Copiloto: ${base.servidor}/${base.base}`);
  if (escribir) confirmarBaseDeDatos('guardar el entradaAlmacenId de los movimientos anteriores al 2026-09-16');

  const { initializeApp, applicationDefault, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  const prisma = new PrismaClient();
  try {
    const movimientos = await prisma.movimiento.findMany({ include: { conceptos: true } });
    const ligadas = new Set(movimientos.map((m) => m.entradaAlmacenId).filter(Boolean));
    const entradas = (await db.collection('entradas_almacen').get()).docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((e) => !e.movimientoId && !ligadas.has(e.id));
    const instante = (e) => (e.fechaOcurrencia?.toDate ? e.fechaOcurrencia.toDate() : new Date(e.fechaOcurrencia)).getTime();

    const pares = [];
    const dudosas = [];
    for (const e of entradas) {
      const t = instante(e);
      const candidatos = movimientos.filter((m) => m.fechaOcurrencia.getTime() === t);
      const entradasMismoInstante = entradas.filter((otra) => instante(otra) === t);
      const m = candidatos[0];
      if (candidatos.length === 1 && entradasMismoInstante.length === 1 && m.contexto === 'NEGOCIO' && !m.entradaAlmacenId && articulosIguales(e, m)) {
        pares.push({ entrada: e, movimiento: m });
      } else {
        dudosas.push({ entrada: e, candidatos: candidatos.length });
      }
    }

    console.log(`\n${entradas.length} entradas de almacén sin movimiento ligado.`);
    pares.forEach(({ entrada, movimiento: m }) => {
      console.log(`  ${m.fechaOcurrencia.toISOString().slice(0, 10)}  $${Number(m.importe).toFixed(2).padStart(10)}  movimiento ${m.id} ← entrada ${entrada.id}`);
    });
    if (dudosas.length) {
      console.log(`\n${dudosas.length} sin pareja segura; no se tocan:`);
      dudosas.forEach(({ entrada, candidatos }) => console.log(`  entrada ${entrada.id}: ${candidatos} movimientos con su mismo instante`));
    }
    console.log(`\n${pares.length} pares seguros.`);

    if (!escribir) {
      console.log('Solo se mostró. Para guardar los pares: --escribir con CONFIRMAR_BASE.');
      return;
    }
    for (const { entrada, movimiento } of pares) {
      await prisma.movimiento.update({ where: { id: movimiento.id }, data: { entradaAlmacenId: entrada.id } });
    }
    console.log(`Listo. ${pares.length} movimientos ligados a su entrada de almacén.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
