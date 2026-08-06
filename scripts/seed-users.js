// Cuentas iniciales para arrancar un entorno vacio. Lleva contrasenas de
// ejemplo ESCRITAS EN CLARO aqui abajo: ejecutarlo contra la base donde opera
// el negocio daria de alta cuentas con credenciales que estan publicadas en el
// repositorio. Por eso pasa por la guardia igual que los que borran -- el dano
// aqui no es perder datos, es abrir la puerta.
//
// Para altas y cambios en una base con datos reales, usar update-users.js, que
// toma las contrasenas de una variable de entorno.

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { confirmarBaseDeDatos } = require('./guardia-base');

const prisma = new PrismaClient();

async function main() {
  confirmarBaseDeDatos('dar de alta cuentas con contrasenas de ejemplo');

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
    // Solo el mensaje, como en los guiones hermanos: el aviso de la guardia se
    // lee, y enterrado en una traza de pila no lo lee nadie.
    console.error(`\nError: ${e.message}`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
