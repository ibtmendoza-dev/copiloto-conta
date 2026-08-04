// Borra TODOS los movimientos, conceptos y comprobantes. No toca usuarios.
//
// Uso:
//   CONFIRMAR_BORRADO=SI node --env-file=.env scripts/reset-db.js
//
// La confirmacion explicita no es burocracia. Este script se escribio cuando
// la base solo tenia datos de prueba y vaciarla era inofensivo. Desde el
// 2026-08-04 hay movimientos reales, y ejecutarlo sin querer -- por historial
// de la terminal, por copiar una linea de la documentacion -- borraria
// contabilidad de verdad sin ninguna forma de recuperarla, porque la ventana
// de restauracion del plan gratuito de Neon es corta.
//
// Ademas imprime lo que va a borrar y espera cinco segundos antes de hacerlo.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  if (process.env.CONFIRMAR_BORRADO !== 'SI') {
    console.error(
      'Este script BORRA todos los movimientos, conceptos y comprobantes.\n' +
      'Si es lo que quieres, vuelve a ejecutarlo con CONFIRMAR_BORRADO=SI'
    );
    process.exitCode = 1;
    return;
  }

  const [movimientos, conceptos, comprobantes] = await Promise.all([
    prisma.movimiento.count(),
    prisma.concepto.count(),
    prisma.comprobante.count()
  ]);

  if (movimientos === 0 && conceptos === 0 && comprobantes === 0) {
    console.log('No hay nada que borrar.');
    return;
  }

  console.log('Se van a borrar, sin posibilidad de deshacer:');
  console.log(`  ${movimientos} movimiento(s)`);
  console.log(`  ${conceptos} concepto(s)`);
  console.log(`  ${comprobantes} comprobante(s)`);
  console.log('\nCancela con Control+C. Empieza en 5 segundos...');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // El orden importa: los conceptos y comprobantes cuelgan del movimiento.
  await prisma.comprobante.deleteMany();
  await prisma.concepto.deleteMany();
  await prisma.movimiento.deleteMany();

  // Los usuarios NO se borran, a proposito: recrearlos les cambia el
  // identificador y cualquier movimiento futuro dejaria de poder enlazarse
  // con el historico. Para altas y cambios de cuenta, usar update-users.js.
  console.log('\nHecho. Los usuarios y sus sesiones no se han tocado.');

  // Las imagenes de los comprobantes viven en Vercel Blob y NO se borran
  // aqui: este script solo conoce la base de datos. Quedan huerfanas en el
  // almacen, ocupando espacio sin que nada las referencie. Es el mismo
  // problema de frontera que documenta DISENO-libro-de-dinero.md §9.
  console.log('AVISO: las imagenes siguen en Vercel Blob, ahora sin referencia.');
}

main()
  .catch((e) => {
    console.error(`\nError: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
