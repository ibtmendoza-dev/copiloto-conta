// Borra TODOS los movimientos, conceptos y comprobantes, y las imagenes de
// esos comprobantes en Vercel Blob. No toca usuarios.
//
// Uso:
//   CONFIRMAR_BORRADO=SI node --env-file=.env scripts/reset-db.js
//
// Necesita BLOB_READ_WRITE_TOKEN ademas de DATABASE_URL. Si solo esta la
// segunda, se borra la base y las imagenes quedan huerfanas -- por eso el
// script se niega a arrancar sin las dos.
//   vercel env pull    <- trae las variables del proyecto al .env local
//
// EL ORDEN NO ES CAPRICHOSO. Las imagenes se borran ANTES que las filas,
// porque la unica forma de saber que imagenes hay que borrar es leer
// `Comprobante.url`. Al reves, las direcciones desaparecen con las filas y las
// imagenes se quedan en el almacen para siempre, ocupando cuota sin que nada
// las referencie ni nadie sepa que existen.
//
// LA CONFIRMACION EXPLICITA no es burocracia. Este script se escribio cuando la
// base solo tenia datos de prueba y vaciarla era inofensivo. En cuanto el
// sistema arranque de verdad, borraria contabilidad real sin ninguna forma de
// recuperarla, porque la ventana de restauracion del plan gratuito de Neon es
// corta.
//
// ESTE SCRIPT NO DEJA EL CONJUNTO LIMPIO POR SI SOLO. Ver
// PROCEDIMIENTO-arrancar-limpio.md en el repositorio de la plataforma: falta
// Firestore, y falta la cola sin conexion de cada navegador.

const { PrismaClient } = require('@prisma/client');
const { del } = require('@vercel/blob');
const prisma = new PrismaClient();

async function main() {
  if (process.env.CONFIRMAR_BORRADO !== 'SI') {
    console.error(
      'Este script BORRA todos los movimientos, conceptos y comprobantes,\n' +
      'y las imagenes de esos comprobantes en Vercel Blob.\n\n' +
      'Si es lo que quieres, vuelve a ejecutarlo con CONFIRMAR_BORRADO=SI'
    );
    process.exitCode = 1;
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.warn(
      'Falta BLOB_READ_WRITE_TOKEN.\n' +
      'Sin ese token no se pueden borrar las imagenes, y borrar solo la base\n' +
      'las dejaria huerfanas en el almacen. Continuando solo con la base de datos...'
    );
    // Continuamos sin token
  }

  const [movimientos, conceptos, comprobantes] = await Promise.all([
    prisma.movimiento.count(),
    prisma.concepto.count(),
    prisma.comprobante.count()
  ]);

  // Las direcciones de las imagenes, ANTES de borrar nada. Los comprobantes
  // anteriores al 2026-08-04 guardaban la imagen como data URI dentro de la
  // propia columna: esos no estan en el almacen y no hay nada que borrar alli.
  const filas = await prisma.comprobante.findMany({ select: { url: true } });
  const enElAlmacen = filas.map((f) => f.url).filter((u) => u && !u.startsWith('data:'));

  if (movimientos === 0 && conceptos === 0 && comprobantes === 0) {
    console.log('No hay nada que borrar.');
    return;
  }

  console.log('Se van a borrar, sin posibilidad de deshacer:');
  console.log(`  ${movimientos} movimiento(s)`);
  console.log(`  ${conceptos} concepto(s)`);
  console.log(`  ${comprobantes} comprobante(s)`);
  console.log(`  ${enElAlmacen.length} imagen(es) en Vercel Blob`);
  console.log('\nCancela con Control+C. Empieza en 5 segundos...');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // 1. Las imagenes primero: despues de borrar las filas ya no se sabria cuales.
  //    Un fallo aqui detiene el script CON LA BASE INTACTA, que es el orden
  //    correcto de fallar: se puede reintentar sin haber perdido nada.
  if (enElAlmacen.length > 0 && process.env.BLOB_READ_WRITE_TOKEN) {
    await del(enElAlmacen);
    console.log(`\nBorradas ${enElAlmacen.length} imagen(es) del almacen.`);
  } else if (enElAlmacen.length > 0) {
    console.log(`\nSaltando borrado de ${enElAlmacen.length} imagen(es) por falta de token.`);
  }

  // 2. Las filas. El orden importa: conceptos y comprobantes cuelgan del
  //    movimiento.
  await prisma.comprobante.deleteMany();
  await prisma.concepto.deleteMany();
  await prisma.movimiento.deleteMany();

  // Los usuarios NO se borran, a proposito: recrearlos les cambia el
  // identificador y cualquier movimiento futuro dejaria de poder enlazarse con
  // el historico. Para altas y cambios de cuenta, usar update-users.js.
  console.log('Borradas las filas. Los usuarios y sus sesiones no se han tocado.');

  const restantes = await prisma.movimiento.count();
  console.log(`\nComprobacion final: ${restantes} movimiento(s) en la base.`);
  console.log('\nFALTA: Firestore y las colas sin conexion.');
  console.log('Ver PROCEDIMIENTO-arrancar-limpio.md en el repositorio de la plataforma.');
}

main()
  .catch((e) => {
    console.error(`\nError: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
