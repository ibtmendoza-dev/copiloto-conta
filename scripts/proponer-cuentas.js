// Le pide a la IA la cuenta de costo de lo ya capturado que la plataforma no
// sabe clasificar (2026-10-12, incremento 7 de Costos operativos de
// lps-platform, decisión 3 del usuario: "lo ya capturado").
//
// POR QUÉ. Desde hoy el Copiloto propone la cuenta al capturar
// (src/lib/propuesta.mjs). Lo capturado antes no tiene propuesta, y en la
// pestaña Costos se queda "por clasificar". Este guion pide las propuestas de
// una sola vez, con el mismo catálogo y las mismas reglas que la captura.
//
// QUÉ HACE, en este orden (el mismo camino que reclasificar-insumos.js):
//   1. Lee la lista que deja `node scripts/conceptos-por-clasificar.js` en
//      lps-platform: los conceptos que hoy no tienen cuenta allá.
//   2. Lee esos conceptos y sus movimientos de Neon, y el catálogo de cuentas
//      y sucursales de la plataforma.
//   3. Le pide a la IA, en UNA llamada, la cuenta de cada uno (o "ninguna") y
//      la sucursal si el texto la nombra, con un motivo corto. Imprime la tabla
//      y, con --guardar=<archivo>, la guarda para revisarla.
//   4. Con --escribir y --desde=<archivo revisado> escribe exactamente lo
//      revisado: `cuentaCostoPropuesta` en cada concepto, `idPdvPropuesto` en
//      el movimiento si no tenía, y vuelve a escribir su espejo. La IA no es
//      determinista: lo que se escribe es lo que se revisó, no otra llamada.
//      `--no=<conceptoId,...>` quita propuestas de la lista revisada.
//
// La fecha real no se pide aquí: de lo capturado hace semanas, "ayer" ya no
// dice nada seguro.
//
// Uso:
//   GOOGLE_APPLICATION_CREDENTIALS=<llave> node --env-file=.env scripts/proponer-cuentas.js --conceptos=<lista.json> --guardar=<propuestas.json>
//   CONFIRMAR_BASE=<servidor> GOOGLE_APPLICATION_CREDENTIALS=<llave> node --env-file=.env scripts/proponer-cuentas.js --conceptos=<lista.json> --desde=<propuestas.json> --escribir [--no=id1,id2]

const { readFileSync, writeFileSync } = require('node:fs');
const { PrismaClient } = require('@prisma/client');
const { confirmarBaseDeDatos, describirBase } = require('./guardia-base');

const escribir = process.argv.includes('--escribir');
const valorDe = (prefijo) => (process.argv.find((a) => a.startsWith(prefijo)) || '').slice(prefijo.length);
const quitar = new Set(valorDe('--no=').split(',').map((s) => s.trim()).filter(Boolean));
const pesos = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

async function firestore() {
  const { initializeApp, applicationDefault, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Hace falta GOOGLE_APPLICATION_CREDENTIALS con la llave de servicio de Firebase.');
  if (!getApps().length) initializeApp({ credential: applicationDefault() });
  return getFirestore();
}

async function pedirALaIA(items, catalogo, p) {
  const { generateObject } = await import('ai');
  const { google } = await import('@ai-sdk/google');
  const { z } = await import('zod');
  const idsCuenta = [p.NINGUNA, ...catalogo.cuentas.map((c) => c.id)];
  const idsPdv = [p.NINGUNA, ...catalogo.pdvs.map((x) => x.id)];
  const { object } = await generateObject({
    model: google('gemini-3.6-flash'),
    maxRetries: 0,
    system: `Clasificas renglones de gastos de un negocio de sushi en México en sus cuentas de costo. Cada renglón trae lo que se escribió o dictó al capturarlo, la categoría y el proveedor.
${p.instruccionDePropuesta(catalogo, p.hoyEnMexico())}
Devuelve un veredicto por renglón, en el mismo orden, con un motivo de pocas palabras. Si no estás seguro, "${p.NINGUNA}".`,
    prompt: items.map((x, i) => `${i + 1}. «${x.descripcion}» por ${pesos(x.importe)}, del movimiento «${x.descripcionOriginal}» (categoría ${x.categoria || '—'}, proveedor ${x.contraparte || '—'})`).join('\n'),
    schema: z.object({
      veredictos: z.array(z.object({
        numero: z.number(),
        cuentaCosto: z.enum(idsCuenta),
        sucursal: z.enum(idsPdv),
        motivo: z.string()
      }))
    })
  });
  const porNumero = new Map(object.veredictos.map((v) => [v.numero, v]));
  return items.map((x, i) => {
    const v = porNumero.get(i + 1) || { cuentaCosto: p.NINGUNA, sucursal: p.NINGUNA, motivo: 'sin veredicto de la IA' };
    const n = p.normalizarPropuesta({ contexto: 'NEGOCIO', sucursal: v.sucursal, articulos: [{ cuentaCosto: v.cuentaCosto }] }, catalogo, p.hoyEnMexico());
    return { conceptoId: x.conceptoId, movimientoId: x.movimientoId, cuentaCosto: n.cuentas[0], idPdv: n.idPdvPropuesto, motivo: v.motivo };
  });
}

async function main() {
  const p = await import('../src/lib/propuesta.mjs');
  const { COLECCION_ESPEJO, debeEspejar, payloadMovimientoFinanzas } = await import('../src/lib/espejo.mjs');
  const archivoConceptos = valorDe('--conceptos=');
  if (!archivoConceptos) throw new Error('Falta --conceptos=<archivo> (lo deja node scripts/conceptos-por-clasificar.js en lps-platform).');
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL. Uso: node --env-file=.env scripts/proponer-cuentas.js ...');
  const base = describirBase(process.env.DATABASE_URL);
  console.log(`Copiloto: ${base.servidor}/${base.base}`);
  if (escribir) {
    if (!valorDe('--desde=')) throw new Error('Para escribir hace falta --desde=<archivo revisado>: se escribe lo que se revisó, no otra respuesta de la IA.');
    confirmarBaseDeDatos('guardar la cuenta propuesta de los conceptos ya capturados');
  }

  const lista = JSON.parse(readFileSync(archivoConceptos, 'utf8'));
  const db = await firestore();
  const [cuentas, pdvs] = await Promise.all([db.collection('cuentas_costo').get(), db.collection('puntos_venta').get()]);
  const catalogo = p.catalogoDePropuesta(cuentas.docs.map((d) => ({ id: d.id, ...d.data() })), pdvs.docs.map((d) => ({ id: d.id, ...d.data() })));
  const nombreCuenta = (id) => catalogo.cuentas.find((c) => c.id === id)?.nombre || '—';
  const nombrePdv = (id) => catalogo.pdvs.find((x) => x.id === id)?.nombre || '';

  const prisma = new PrismaClient();
  try {
    const conceptos = await prisma.concepto.findMany({ where: { id: { in: lista.map((x) => x.conceptoId) } }, include: { movimiento: true } });
    const porId = new Map(conceptos.map((c) => [c.id, c]));
    const items = lista.filter((x) => porId.has(x.conceptoId) && porId.get(x.conceptoId).movimiento.contexto === 'NEGOCIO').map((x) => {
      const c = porId.get(x.conceptoId);
      return { ...x, descripcionOriginal: c.movimiento.descripcionOriginal, categoria: c.movimiento.categoria, contraparte: c.movimiento.contraparteNombre };
    });
    console.log(`${lista.length} conceptos en la lista; ${items.length} encontrados en el Copiloto y del negocio.\n`);
    if (items.length === 0) return;

    const desde = valorDe('--desde=');
    const propuestas = desde ? JSON.parse(readFileSync(desde, 'utf8')) : await pedirALaIA(items, catalogo, p);
    const porConcepto = new Map(propuestas.map((x) => [x.conceptoId, x]));

    console.log('fecha      |      importe | descripción                                  | propuesta                          | motivo | concepto');
    let conCuenta = 0;
    let importeConCuenta = 0;
    items.forEach((x) => {
      const pr = porConcepto.get(x.conceptoId) || {};
      const fuera = quitar.has(x.conceptoId);
      const texto = pr.cuentaCosto && !fuera ? `${nombreCuenta(pr.cuentaCosto)}${pr.idPdv ? ` · ${nombrePdv(pr.idPdv)}` : ''}` : (fuera ? '(quitada con --no)' : 'ninguna');
      if (pr.cuentaCosto && !fuera) { conCuenta += 1; importeConCuenta += x.importe; }
      console.log(`${x.fecha} | ${pesos(x.importe).padStart(12)} | ${x.descripcion.slice(0, 44).padEnd(44)} | ${texto.slice(0, 34).padEnd(34)} | ${pr.motivo || ''} | ${x.conceptoId}`);
    });
    console.log(`\n${conCuenta} de ${items.length} con propuesta (${pesos(importeConCuenta)}).`);

    const guardar = valorDe('--guardar=');
    if (guardar) {
      writeFileSync(guardar, JSON.stringify(propuestas, null, 2));
      console.log(`Propuestas guardadas en ${guardar}: revísalas y escribe con --desde=${guardar} --escribir.`);
    }
    if (!escribir) {
      console.log('\nSolo se mostró. Nada se escribió.');
      return;
    }

    const movimientosTocados = new Set();
    for (const x of items) {
      const pr = porConcepto.get(x.conceptoId);
      if (!pr || !pr.cuentaCosto || quitar.has(x.conceptoId)) continue;
      await prisma.concepto.update({ where: { id: x.conceptoId }, data: { cuentaCostoPropuesta: pr.cuentaCosto } });
      if (pr.idPdv) await prisma.movimiento.updateMany({ where: { id: x.movimientoId, idPdvPropuesto: null }, data: { idPdvPropuesto: pr.idPdv } });
      movimientosTocados.add(x.movimientoId);
    }
    const ahora = new Date();
    for (const id of movimientosTocados) {
      const m = await prisma.movimiento.findUnique({ where: { id }, include: { conceptos: true } });
      if (m && debeEspejar(m)) await db.collection(COLECCION_ESPEJO).doc(m.id).set(payloadMovimientoFinanzas(m, ahora));
    }
    console.log(`\nListo. ${conCuenta} conceptos con su propuesta, ${movimientosTocados.size} movimientos vueltos a espejar.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
