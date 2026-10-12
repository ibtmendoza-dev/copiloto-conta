// Rellena y coteja el espejo del Copiloto en la plataforma de producción
// (LPS Platform, colección `movimientos_finanzas`), 2026-10-11.
//
// POR QUÉ. Desde hoy cada movimiento del NEGOCIO se copia a la plataforma al
// crearlo, al cambiar su marca de insumo y al borrarlo (src/app/actions.ts,
// src/lib/espejo.mjs). Lo capturado antes nunca cruzó: la renta, la luz, la
// gasolina y el chofer no estaban en la pestaña Costos de Dirección. Este
// guion copia lo anterior y, cada vez que se corre, compara por mes lo de aquí
// contra lo de allá. Ya pasó que algo se borró de un solo lado ($2,780 en
// compras huérfanas, lps-platform/docs/DISENO-libro-de-dinero.md §9).
//
// QUÉ HACE, en este orden:
//   1. Dice de qué base lee (servidor y nombre, sin credenciales) y a qué
//      proyecto de Firebase escribiría.
//   2. Lee de Neon los movimientos del NEGOCIO desde --desde (por defecto el
//      2026-08-06, cuando el Copiloto empezó a operar), con sus conceptos.
//   3. Si hay llave de Firebase, lee el espejo desde la misma fecha y enseña el
//      cotejo por mes, y qué movimientos faltan, difieren o sobran allá.
//   4. Con --escribir: escribe los que faltan o difieren, con `set` sobre el id
//      del movimiento (correrlo dos veces no duplica), y coteja otra vez.
//      Los que sobran allá NO se borran: se enseñan para revisarlos a mano.
//
// Uso:
//   node --env-file=.env scripts/espejar-movimientos.js
//   GOOGLE_APPLICATION_CREDENTIALS=<llave de Firebase> node --env-file=.env scripts/espejar-movimientos.js
//   CONFIRMAR_BASE=<servidor> GOOGLE_APPLICATION_CREDENTIALS=<llave> \
//     node --env-file=.env scripts/espejar-movimientos.js --escribir [--desde=2026-08-06]
//
// La llave es la misma cuenta de servicio que usan los guiones de lps-platform
// (su carpeta .secrets). En Vercel no hace falta: allá el espejo usa las
// variables FIREBASE_* del despliegue.

const { readFileSync } = require('node:fs');
const { PrismaClient } = require('@prisma/client');
const { confirmarBaseDeDatos, describirBase } = require('./guardia-base');

const escribir = process.argv.includes('--escribir');
const desdeTexto = (process.argv.find((a) => a.startsWith('--desde=')) || '--desde=2026-08-06').slice('--desde='.length);
if (!/^\d{4}-\d{2}-\d{2}$/.test(desdeTexto)) throw new Error(`--desde debe ser una fecha AAAA-MM-DD; llegó "${desdeTexto}".`);
// Medianoche en la Ciudad de México (sin horario de verano desde 2022).
const desde = new Date(`${desdeTexto}T00:00:00-06:00`);

const pesos = (n) => `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Solo el proyecto de la llave: nada más de ese archivo se lee ni se imprime. */
function proyectoDeLaLlave(ruta) {
  try {
    return JSON.parse(readFileSync(ruta, 'utf8')).project_id || '(sin project_id)';
  } catch {
    throw new Error(`No se pudo leer la llave de Firebase en GOOGLE_APPLICATION_CREDENTIALS (${ruta}).`);
  }
}

async function firestore() {
  const { initializeApp, applicationDefault, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) initializeApp({ credential: applicationDefault() });
  return getFirestore();
}

function linea(e) {
  return `  ${e.momento.slice(0, 10)}  ${e.tipo.padEnd(6)} ${pesos(e.importe).padStart(12)}  ${String(e.descripcionOriginal || '').replace(/\s+/g, ' ').slice(0, 60)}  (${e.movimientoId})`;
}

function imprimirCotejo(r) {
  console.log('\nmes      | en el Copiloto            | en la plataforma          | ');
  r.porMes.forEach((f) => {
    const lado = (l) => `${String(l.movimientos).padStart(4)} mov. ${pesos(l.total).padStart(14)}`;
    console.log(`${f.mes}  | ${lado(f.neon)}  | ${lado(f.espejo)}  | ${f.cuadra ? 'cuadra' : 'NO CUADRA'}`);
  });
  const lista = (titulo, filas) => {
    if (!filas.length) return;
    console.log(`\n${titulo} (${filas.length}):`);
    filas.slice(0, 15).forEach((e) => console.log(linea(e)));
    if (filas.length > 15) console.log(`  … y ${filas.length - 15} más.`);
  };
  lista('Faltan en la plataforma', r.faltan);
  lista('Difieren (se escribirían otra vez)', r.difieren);
  lista('Sobran en la plataforma: ya no están en el Copiloto; NO se borran solos, revísalos', r.sobran);
  console.log(r.cuadra ? '\nEl espejo cuadra con el Copiloto.' : '');
}

async function main() {
  const { COLECCION_ESPEJO, payloadMovimientoFinanzas, cotejarEspejo } = await import('../src/lib/espejo.mjs');

  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL. Uso: node --env-file=.env scripts/espejar-movimientos.js');
  const base = describirBase(process.env.DATABASE_URL);
  console.log(`Lee del Copiloto: ${base.servidor}/${base.base}`);
  const llave = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  console.log(llave ? `Plataforma: proyecto de Firebase ${proyectoDeLaLlave(llave)}` : 'Plataforma: sin llave de Firebase (GOOGLE_APPLICATION_CREDENTIALS); solo se cuenta lo del Copiloto.');
  if (escribir) {
    if (!llave) throw new Error('Para escribir en la plataforma hace falta GOOGLE_APPLICATION_CREDENTIALS con la llave de servicio de Firebase.');
    confirmarBaseDeDatos('copiar los movimientos del negocio de esta base a la plataforma');
  }

  const prisma = new PrismaClient();
  try {
    const movimientos = await prisma.movimiento.findMany({
      where: { contexto: 'NEGOCIO', fechaOcurrencia: { gte: desde } },
      include: { conceptos: true },
      orderBy: { fechaOcurrencia: 'asc' }
    });
    const ahora = new Date();
    const esperados = movimientos.map((m) => payloadMovimientoFinanzas(m, ahora));
    const porTipo = esperados.reduce((acc, e) => ({ ...acc, [e.tipo]: (acc[e.tipo] || 0) + 1 }), {});
    console.log(`\n${esperados.length} movimientos del negocio desde el ${desdeTexto}, con ${esperados.reduce((s, e) => s + e.conceptos.length, 0)} conceptos.`);
    console.log(`Por tipo: ${Object.entries(porTipo).map(([t, n]) => `${t} ${n}`).join(', ') || 'ninguno'}.`);

    if (!llave) {
      imprimirCotejo(cotejarEspejo(esperados, esperados));
      console.log('Sin llave no hay cotejo: las dos columnas son lo del Copiloto.');
      return;
    }

    const db = await firestore();
    const leerEspejo = async () => (await db.collection(COLECCION_ESPEJO).where('momento', '>=', desde.toISOString()).get())
      .docs.map((d) => ({ movimientoId: d.id, ...d.data() }));

    const antes = cotejarEspejo(esperados, await leerEspejo());
    imprimirCotejo(antes);

    if (!escribir) {
      const porEscribir = antes.faltan.length + antes.difieren.length;
      console.log(porEscribir
        ? `\nSolo se comparó. ${porEscribir} movimientos se escribirían con --escribir (y CONFIRMAR_BASE).`
        : '\nSolo se comparó. No hay nada que escribir.');
      return;
    }

    const porEscribir = [...antes.faltan, ...antes.difieren];
    for (let i = 0; i < porEscribir.length; i += 400) {
      const lote = db.batch();
      porEscribir.slice(i, i + 400).forEach((e) => lote.set(db.collection(COLECCION_ESPEJO).doc(e.movimientoId), e));
      await lote.commit();
    }
    console.log(`\nEscritos ${porEscribir.length} movimientos en ${COLECCION_ESPEJO}. Cotejo después de escribir:`);
    imprimirCotejo(cotejarEspejo(esperados, await leerEspejo()));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
