const { PrismaClient } = require('@prisma/client'); 
const prisma = new PrismaClient(); 

prisma.movimiento.findMany({ 
  orderBy: { createdAt: 'desc' }, 
  take: 5 
})
.then(data => {
  console.log(JSON.stringify(data, null, 2));
})
.catch(console.error)
.finally(() => prisma.$disconnect());
