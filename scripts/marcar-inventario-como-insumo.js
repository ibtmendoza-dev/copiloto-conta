// Marca como insumo todos los artículos de los movimientos NEGOCIO/INVENTARIO
// capturados antes del 2026-09-16, de una sola vez.
//
// POR QUÉ. Hasta ese día la categoría INVENTARIO significaba "todo el
// movimiento es insumo" y el puente la trataba como caso aparte. Desde que la
// casilla del historial permite quitar la marca a un artículo suelto, el
// puente mira solo la marca de cada artículo (src/lib/insumos.ts), y los
// INVENTARIO viejos, que nacieron con la columna en su valor por defecto
// (false), quedarían fuera. Este guion les pone la marca que la categoría ya
// decía. No toca Firestore: esos movimientos ya están en la plataforma.
//
// Uso:
//   node --env-file=.env scripts/marcar-inventario-como-insumo.js            (solo cuenta)
//   CONFIRMAR_BASE=<servidor> node --env-file=.env scripts/marcar-inventario-como-insumo.js --escribir

const { PrismaClient } = require('@prisma/client');
const { confirmarBaseDeDatos } = require('./guardia-base');

const escribir = process.argv.includes('--escribir');

async function main() {
  const prisma = new PrismaClient();
  try {
    if (escribir) confirmarBaseDeDatos('marcar como insumo los artículos de los movimientos INVENTARIO');
    const pendientes = await prisma.concepto.count({
      where: { esInsumo: false, movimiento: { contexto: 'NEGOCIO', categoria: 'INVENTARIO' } }
    });
    console.log(`${pendientes} artículos de movimientos NEGOCIO/INVENTARIO sin la marca de insumo.`);
    if (!escribir) {
      console.log('Solo se contó. Para escribir: --escribir con CONFIRMAR_BASE.');
      return;
    }
    const r = await prisma.concepto.updateMany({
      where: { esInsumo: false, movimiento: { contexto: 'NEGOCIO', categoria: 'INVENTARIO' } },
      data: { esInsumo: true }
    });
    console.log(`Listo. ${r.count} artículos marcados.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
