const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const adminPass = await bcrypt.hash('admin123', 10);
  const operatorPass = await bcrypt.hash('operador123', 10);
  
  await prisma.usuario.upsert({
    where: { email: 'anton@empresa.com' },
    update: {},
    create: { email: 'anton@empresa.com', password: adminPass, nombre: 'Anton', rol: 'ADMIN' }
  });
  
  await prisma.usuario.upsert({
    where: { email: 'madi@empresa.com' },
    update: {},
    create: { email: 'madi@empresa.com', password: adminPass, nombre: 'Madi', rol: 'ADMIN' }
  });

  await prisma.usuario.upsert({
    where: { email: 'empleado@empresa.com' },
    update: {},
    create: { email: 'empleado@empresa.com', password: operatorPass, nombre: 'Empleado', rol: 'OPERADOR' }
  });

  console.log("Usuarios iniciales creados exitosamente.");
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
