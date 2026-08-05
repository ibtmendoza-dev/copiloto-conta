const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const movimientos = await prisma.movimiento.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3,
    include: { usuario: true, conceptos: true }
  });
  console.log(JSON.stringify(movimientos, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
