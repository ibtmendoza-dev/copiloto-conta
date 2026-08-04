// Aplica prisma/sql/libro-invariantes.sql a la base de datos.
//
// Uso:
//   node --env-file=.env scripts/aplicar-invariantes-libro.js
//
// Hay que ejecutarlo despues de cada `prisma db push` que recree las tablas
// del libro: los disparadores se van con la tabla y no vuelven solos. El
// archivo es idempotente, asi que ejecutarlo de mas no hace daño.
//
// Al terminar comprueba que las protecciones estan puestas de verdad,
// intentando escribir un asiento descuadrado dentro de una transaccion que
// siempre se deshace. Comprobar que existe el disparador no basta: lo que
// importa es que rechace.

const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SQL = path.join(__dirname, '..', 'prisma', 'sql', 'libro-invariantes.sql');

/**
 * Parte el archivo en sentencias sueltas.
 *
 * No vale con cortar por `;`: los cuerpos de funcion van entre `$$ ... $$` y
 * llevan puntos y coma dentro; cortar ahi partiria cada funcion por la mitad.
 * Esto recorre el texto llevando la cuenta de si esta dentro de un bloque
 * `$$` o de un comentario de linea.
 */
function partirEnSentencias(sql) {
  const sentencias = [];
  let actual = '';
  let enBloque = false;
  let enComentario = false;

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];

    if (enComentario) {
      if (c === '\n') { enComentario = false; actual += c; }
      continue;
    }
    if (!enBloque && c === '-' && sql[i + 1] === '-') { enComentario = true; i++; continue; }
    if (c === '$' && sql[i + 1] === '$') { enBloque = !enBloque; actual += '$$'; i++; continue; }

    if (c === ';' && !enBloque) {
      if (actual.trim()) sentencias.push(actual.trim());
      actual = '';
      continue;
    }
    actual += c;
  }
  if (actual.trim()) sentencias.push(actual.trim());
  return sentencias;
}

async function aplicar() {
  const sentencias = partirEnSentencias(readFileSync(SQL, 'utf8'));
  // Una a una: `$executeRawUnsafe` usa una sentencia preparada y PostgreSQL no
  // admite varias ordenes dentro de una.
  for (const s of sentencias) {
    await prisma.$executeRawUnsafe(s);
  }
  console.log(`Invariantes aplicadas (${sentencias.length} sentencias).`);
}

/** Intenta algo que DEBE fallar. Devuelve true si efectivamente fallo. */
async function debeRechazar(descripcion, fn) {
  try {
    await prisma.$transaction(async (tx) => {
      await fn(tx);
      // Fuerza la comprobacion de los disparadores diferidos AQUI, sin llegar a
      // confirmar: si no, se comprobarian al hacer commit, y como esta
      // transaccion siempre se deshace, no se comprobarian nunca.
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      throw new Error('__no_rechazo__');
    });
    console.log(`  FALLO: ${descripcion} -- se acepto y no deberia.`);
    return false;
  } catch (e) {
    if (e.message === '__no_rechazo__') {
      console.log(`  FALLO: ${descripcion} -- se acepto y no deberia.`);
      return false;
    }
    const motivo = String(e.message).split('\n').find((l) => l.includes('asiento') || l.includes('apunte') || l.includes('constraint')) || '';
    console.log(`  OK: ${descripcion}`);
    if (motivo) console.log(`      ${motivo.trim().slice(0, 110)}`);
    return true;
  }
}

async function comprobar() {
  console.log('\nComprobando que las protecciones rechazan de verdad:');

  const idCuenta = `prueba-${Date.now()}`;
  const idAsiento = `prueba-asiento-${Date.now()}`;
  let todoBien = true;

  // La cuenta de apoyo se crea y se borra: no queda nada en el libro.
  await prisma.cuenta.create({
    data: { id: idCuenta, contribuyenteId: 'prueba', nombre: `prueba-${Date.now()}`, tipo: 'ACTIVO' }
  });

  try {
    todoBien &= await debeRechazar('un asiento que no cuadra', async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "Asiento" (id, "contribuyenteId", "fechaOcurrencia", descripcion, origen, estado, "createdAt")
         VALUES ($1, 'prueba', NOW(), 'descuadrado', 'MANUAL', 'PROPUESTO', NOW())`, idAsiento);
      await tx.$executeRawUnsafe(
        `INSERT INTO "Apunte" (id, "asientoId", "cuentaId", debe, haber) VALUES ($1, $2, $3, 100, 0)`,
        `${idAsiento}-a`, idAsiento, idCuenta);
      await tx.$executeRawUnsafe(
        `INSERT INTO "Apunte" (id, "asientoId", "cuentaId", debe, haber) VALUES ($1, $2, $3, 0, 90)`,
        `${idAsiento}-b`, idAsiento, idCuenta);
    });

    todoBien &= await debeRechazar('un asiento de un solo apunte', async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "Asiento" (id, "contribuyenteId", "fechaOcurrencia", descripcion, origen, estado, "createdAt")
         VALUES ($1, 'prueba', NOW(), 'un solo lado', 'MANUAL', 'PROPUESTO', NOW())`, `${idAsiento}-solo`);
      await tx.$executeRawUnsafe(
        `INSERT INTO "Apunte" (id, "asientoId", "cuentaId", debe, haber) VALUES ($1, $2, $3, 100, 0)`,
        `${idAsiento}-solo-a`, `${idAsiento}-solo`, idCuenta);
    });

    todoBien &= await debeRechazar('un asiento sin ningun apunte', async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "Asiento" (id, "contribuyenteId", "fechaOcurrencia", descripcion, origen, estado, "createdAt")
         VALUES ($1, 'prueba', NOW(), 'vacio', 'MANUAL', 'PROPUESTO', NOW())`, `${idAsiento}-vacio`);
    });

    todoBien &= await debeRechazar('un apunte con importe negativo', async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "Asiento" (id, "contribuyenteId", "fechaOcurrencia", descripcion, origen, estado, "createdAt")
         VALUES ($1, 'prueba', NOW(), 'negativo', 'MANUAL', 'PROPUESTO', NOW())`, `${idAsiento}-neg`);
      await tx.$executeRawUnsafe(
        `INSERT INTO "Apunte" (id, "asientoId", "cuentaId", debe, haber) VALUES ($1, $2, $3, -100, 0)`,
        `${idAsiento}-neg-a`, `${idAsiento}-neg`, idCuenta);
    });

    todoBien &= await debeRechazar('un apunte que carga y abona a la vez', async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "Asiento" (id, "contribuyenteId", "fechaOcurrencia", descripcion, origen, estado, "createdAt")
         VALUES ($1, 'prueba', NOW(), 'los dos lados', 'MANUAL', 'PROPUESTO', NOW())`, `${idAsiento}-dos`);
      await tx.$executeRawUnsafe(
        `INSERT INTO "Apunte" (id, "asientoId", "cuentaId", debe, haber) VALUES ($1, $2, $3, 100, 100)`,
        `${idAsiento}-dos-a`, `${idAsiento}-dos`, idCuenta);
    });

    // Y uno que SI tiene que pasar: si las protecciones rechazaran tambien lo
    // correcto, el libro seria inservible y esta comprobacion no lo veria.
    console.log('\nComprobando que un asiento correcto SI entra:');
    let entro = false;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO "Asiento" (id, "contribuyenteId", "fechaOcurrencia", descripcion, origen, estado, "createdAt")
           VALUES ($1, 'prueba', NOW(), 'cuadrado', 'MANUAL', 'PROPUESTO', NOW())`, `${idAsiento}-ok`);
        await tx.$executeRawUnsafe(
          `INSERT INTO "Apunte" (id, "asientoId", "cuentaId", debe, haber) VALUES ($1, $2, $3, 100.50, 0)`,
          `${idAsiento}-ok-a`, `${idAsiento}-ok`, idCuenta);
        await tx.$executeRawUnsafe(
          `INSERT INTO "Apunte" (id, "asientoId", "cuentaId", debe, haber) VALUES ($1, $2, $3, 0, 100.50)`,
          `${idAsiento}-ok-b`, `${idAsiento}-ok`, idCuenta);
        await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
        entro = true;
        throw new Error('__deshacer__'); // no dejamos rastro
      });
    } catch (e) {
      if (e.message !== '__deshacer__') {
        console.log(`  FALLO: un asiento correcto fue rechazado -- ${e.message.split('\n')[0]}`);
        entro = false;
      }
    }
    console.log(entro ? '  OK: el asiento cuadrado se acepta' : '  FALLO: se rechaza un asiento correcto');
    todoBien &= entro;

    // --- Inmutabilidad (invariante 2) ---
    // Se prueba sobre un asiento ya escrito, dentro de una transaccion que
    // siempre se deshace. Los disparadores de edicion son BEFORE, no
    // diferidos, asi que saltan en el momento.
    console.log('\nComprobando que un asiento escrito no se puede editar:');

    async function conAsientoEscrito(descripcion, accion, debeFallar) {
      const base = `inm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      let resultado = false;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `INSERT INTO "Asiento" (id, "contribuyenteId", "fechaOcurrencia", descripcion, origen, estado, "createdAt")
             VALUES ($1, 'prueba', NOW(), 'para editar', 'MANUAL', 'PROPUESTO', NOW())`, base);
          await tx.$executeRawUnsafe(
            `INSERT INTO "Apunte" (id, "asientoId", "cuentaId", debe, haber) VALUES ($1, $2, $3, 50, 0)`,
            `${base}-a`, base, idCuenta);
          await tx.$executeRawUnsafe(
            `INSERT INTO "Apunte" (id, "asientoId", "cuentaId", debe, haber) VALUES ($1, $2, $3, 0, 50)`,
            `${base}-b`, base, idCuenta);
          await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');

          try {
            await accion(tx, base);
            resultado = !debeFallar; // paso; correcto solo si NO debia fallar
          } catch {
            resultado = debeFallar;  // fallo; correcto solo si debia fallar
          }
          throw new Error('__deshacer__');
        });
      } catch (e) {
        if (e.message !== '__deshacer__') throw e;
      }
      console.log(`  ${resultado ? 'OK' : 'FALLO'}: ${descripcion}`);
      return resultado;
    }

    todoBien &= await conAsientoEscrito(
      'cambiar la descripcion se rechaza',
      (tx, id) => tx.$executeRawUnsafe(`UPDATE "Asiento" SET descripcion = 'otra cosa' WHERE id = $1`, id),
      true
    );

    todoBien &= await conAsientoEscrito(
      'cambiar el importe de un apunte se rechaza',
      (tx, id) => tx.$executeRawUnsafe(`UPDATE "Apunte" SET debe = 999 WHERE id = $1`, `${id}-a`),
      true
    );

    todoBien &= await conAsientoEscrito(
      'pasar de PROPUESTO a FIRME se permite',
      (tx, id) => tx.$executeRawUnsafe(`UPDATE "Asiento" SET estado = 'FIRME' WHERE id = $1`, id),
      false
    );

    todoBien &= await conAsientoEscrito(
      'confirmar y cambiar otra cosa a la vez se rechaza',
      (tx, id) => tx.$executeRawUnsafe(`UPDATE "Asiento" SET estado = 'FIRME', descripcion = 'colada' WHERE id = $1`, id),
      true
    );
  } finally {
    await prisma.cuenta.delete({ where: { id: idCuenta } }).catch(() => {});
  }

  return Boolean(todoBien);
}

async function main() {
  await aplicar();
  const bien = await comprobar();
  console.log(bien ? '\nTodo correcto. El libro esta protegido.' : '\nHay comprobaciones en rojo. Revisar antes de confiar en el libro.');
  if (!bien) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(`\nError: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
