// Reclasifica por artículo lo ya capturado y lo hace cruzar el puente a la
// plataforma de producción (LPS Platform, colección `entradas_almacen`).
//
// POR QUÉ. Hasta el 2026-09-16 el puente solo pasaba los movimientos
// NEGOCIO/INVENTARIO. Las compras de ingredientes capturadas como ALIMENTOS
// (el chipotle, el aceite de ajonjolí, el vinagre de manzana, el consomé de
// agosto) nunca llegaron. Desde hoy cada concepto lleva `esInsumo` y el puente
// va por artículo (ver src/lib/insumos.ts); este guion pone al día lo anterior.
//
// QUÉ HACE, en este orden:
//   1. Toma los movimientos NEGOCIO que no son INVENTARIO y no han cruzado
//      (entradaAlmacenId nulo), con sus conceptos.
//   2. Le pide a Gemini, en UNA sola llamada, marcar cada descripción como
//      insumo o no, con las MISMAS reglas del prompt de captura (REGLAS_INSUMO).
//   3. Imprime la tabla completa: descripción, veredicto y motivo. Sin
//      `--escribir` termina aquí: la tabla es para que la revises.
//   4. Con `--escribir`: guarda `esInsumo` en cada concepto y, por cada
//      movimiento con algún insumo, escribe la entrada en Firestore y guarda
//      su id en `entradaAlmacenId`. Un movimiento ya cruzado no se repite.
//   5. `--no=<id>,<id>` excluye conceptos que la IA marcó mal; `--si=<id>,...`
//      fuerza como insumo los que marcó mal al revés. Los ids salen en la tabla.
//
// Los 37 NEGOCIO/INVENTARIO de antes ya están en la plataforma y no se tocan.
//
// Uso:
//   node --env-file=.env scripts/reclasificar-insumos.js
//   CONFIRMAR_BASE=<servidor> GOOGLE_APPLICATION_CREDENTIALS=<ruta a la llave de Firebase> \
//     node --env-file=.env scripts/reclasificar-insumos.js --escribir [--no=id1,id2] [--si=id3]
//
// Firestore: en la máquina de escritorio el .env no trae las credenciales de
// Firebase del despliegue; se pasan por GOOGLE_APPLICATION_CREDENTIALS (la
// misma llave de servicio que usan los guiones de lps-platform).

const { PrismaClient } = require('@prisma/client');
const { confirmarBaseDeDatos } = require('./guardia-base');

const escribir = process.argv.includes('--escribir');
const listaDe = (prefijo) => (process.argv.find((a) => a.startsWith(prefijo)) || '').slice(prefijo.length).split(',').map((s) => s.trim()).filter(Boolean);
const forzarNo = new Set(listaDe('--no='));
const forzarSi = new Set(listaDe('--si='));

// Las mismas reglas que usa el prompt de captura: un solo archivo para los dos.
const { REGLAS_INSUMO } = require('../src/lib/reglas-insumo.json');

async function clasificarConIA(descripciones) {
  // Se importa aquí para que sin --escribir ni clave de IA el guion aún pueda
  // fallar con un mensaje claro y no con un error de módulo.
  const { generateObject } = await import('ai');
  const { google } = await import('@ai-sdk/google');
  const { z } = await import('zod');
  const { object } = await generateObject({
    model: google('gemini-3.6-flash'),
    maxRetries: 0,
    system: `Clasificas líneas de tickets de compra de un negocio de sushi en México.\n${REGLAS_INSUMO}\nDevuelve un veredicto por cada línea, en el mismo orden, con un motivo de pocas palabras.`,
    prompt: descripciones.map((d, i) => `${i + 1}. ${d}`).join('\n'),
    schema: z.object({
      veredictos: z.array(z.object({
        numero: z.number(),
        esInsumo: z.boolean(),
        motivo: z.string()
      }))
    })
  });
  const porNumero = new Map(object.veredictos.map((v) => [v.numero, v]));
  return descripciones.map((_, i) => porNumero.get(i + 1) || { esInsumo: false, motivo: 'sin veredicto de la IA' });
}

/**
 * Lee la tabla que imprime este mismo guion y devuelve id → veredicto.
 * Cada fila termina en "| motivo | id"; el veredicto es la tercera columna.
 */
function leerVeredictosGuardados(ruta) {
  const mapa = new Map();
  if (!ruta) return mapa;
  const { readFileSync } = require('node:fs');
  readFileSync(ruta, 'utf8').split(/\r?\n/).forEach((linea) => {
    const partes = linea.split('|').map((p) => p.trim());
    if (partes.length < 6 || !/^\d{4}-\d{2}-\d{2}$/.test(partes[0])) return;
    const id = partes[partes.length - 1];
    const veredicto = partes[2];
    if (!/^[0-9a-f-]{36}$/.test(id)) return;
    mapa.set(id, { esInsumo: veredicto === 'INSUMO', motivo: `${partes[partes.length - 2]} (revisado)` });
  });
  return mapa;
}

async function firestore() {
  const { initializeApp, applicationDefault, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('Para escribir en la plataforma hace falta GOOGLE_APPLICATION_CREDENTIALS con la llave de servicio de Firebase.');
  }
  if (!getApps().length) initializeApp({ credential: applicationDefault() });
  return getFirestore();
}

async function main() {
  const prisma = new PrismaClient();
  try {
    if (escribir) confirmarBaseDeDatos('marcar insumos e inyectar entradas de almacén');

    const movimientos = await prisma.movimiento.findMany({
      where: { contexto: 'NEGOCIO', entradaAlmacenId: null, NOT: { categoria: 'INVENTARIO' } },
      include: { conceptos: true },
      orderBy: { fechaOcurrencia: 'asc' }
    });
    const conceptos = movimientos.flatMap((m) => m.conceptos.map((c) => ({ ...c, movimiento: m })));
    console.log(`${movimientos.length} movimientos del negocio fuera de INVENTARIO sin cruzar, con ${conceptos.length} conceptos.\n`);
    if (conceptos.length === 0) return;

    // `--desde=<archivo>`: reutiliza los veredictos de una corrida en seco ya
    // revisada (el archivo con la tabla impresa), en vez de pedirlos otra vez.
    // La IA no es determinista: lo que se escribe debe ser lo que se revisó.
    // Los conceptos que no estén en el archivo sí van a la IA.
    const guardados = leerVeredictosGuardados(listaDe('--desde=')[0]);
    const sinVeredicto = conceptos.filter((c) => !guardados.has(c.id));
    const deIA = sinVeredicto.length ? await clasificarConIA(sinVeredicto.map((c) => c.descripcion)) : [];
    const porIdIA = new Map(sinVeredicto.map((c, i) => [c.id, deIA[i]]));
    if (guardados.size) console.log(`${guardados.size} veredictos tomados del archivo revisado; ${sinVeredicto.length} pedidos a la IA.\n`);
    const veredictos = conceptos.map((c) => guardados.get(c.id) || porIdIA.get(c.id));
    const filas = conceptos.map((c, i) => {
      let esInsumo = veredictos[i].esInsumo;
      let motivo = veredictos[i].motivo;
      if (forzarNo.has(c.id)) { esInsumo = false; motivo = 'forzado con --no'; }
      if (forzarSi.has(c.id)) { esInsumo = true; motivo = 'forzado con --si'; }
      return { concepto: c, esInsumo, motivo };
    });

    console.log('fecha      | categoría    | veredicto | descripción                                        | motivo | id del concepto');
    filas.forEach(({ concepto: c, esInsumo, motivo }) => {
      console.log(`${c.movimiento.fechaOcurrencia.toISOString().slice(0, 10)} | ${String(c.movimiento.categoria).padEnd(12)} | ${esInsumo ? 'INSUMO   ' : 'no       '} | ${c.descripcion.slice(0, 50).padEnd(50)} | ${motivo} | ${c.id}`);
    });
    const insumos = filas.filter((f) => f.esInsumo);
    const movsConInsumo = new Set(insumos.map((f) => f.concepto.movimientoId));
    console.log(`\n${insumos.length} conceptos serían insumo, en ${movsConInsumo.size} movimientos que cruzarían el puente.`);

    if (!escribir) {
      console.log('\nSolo se mostró la tabla. Revisa los veredictos; corrige con --no=<id,...> o --si=<id,...> y vuelve a correr con --escribir.');
      return;
    }

    const db = await firestore();
    let marcados = 0;
    for (const f of filas) {
      await prisma.concepto.update({ where: { id: f.concepto.id }, data: { esInsumo: f.esInsumo } });
      marcados += 1;
    }
    let cruzados = 0;
    for (const m of movimientos) {
      const articulos = filas.filter((f) => f.esInsumo && f.concepto.movimientoId === m.id).map((f) => f.concepto);
      if (articulos.length === 0) continue;
      const totalGastado = articulos.reduce((s, a) => s + Number(a.importeTotal), 0);
      const payload = {
        fechaOcurrencia: m.fechaOcurrencia,
        origen: 'Copiloto Conta (Finanzas)',
        categoria: m.categoria ?? null,
        movimientoId: m.id,
        totalGastado,
        importeMovimiento: Number(m.importe),
        usuarioId: m.usuarioId ?? null,
        articulos: articulos.map((a) => ({
          cantidad: Number(a.cantidad),
          descripcion: a.descripcion ?? null,
          precioUnitario: a.precioUnitario === null ? null : Number(a.precioUnitario),
          importeTotal: Number(a.importeTotal)
        }))
      };
      const ref = await db.collection('entradas_almacen').add(payload);
      await prisma.movimiento.update({ where: { id: m.id }, data: { entradaAlmacenId: ref.id } });
      cruzados += 1;
    }
    console.log(`\nListo. ${marcados} conceptos marcados, ${cruzados} movimientos cruzaron el puente.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
