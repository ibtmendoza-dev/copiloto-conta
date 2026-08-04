// Da de alta o actualiza las cuentas del copiloto.
//
// Uso:
//   USUARIOS_JSON='[{"email":"...","nombre":"...","rol":"ADMIN","password":"..."}]' \
//     node --env-file=.env scripts/update-users.js
//
// Dos decisiones que conviene no deshacer:
//
// 1. LAS CONTRASENAS NO ESTAN AQUI. Antes iban escritas en claro dentro de
//    este archivo. Un archivo con credenciales acaba tarde o temprano en el
//    historial de git, y de ahi ya no se quitan: borrarlo despues no sirve,
//    el contenido sigue estando en cualquier copia del repositorio. Ahora
//    entran por la variable de entorno USUARIOS_JSON y el archivo es
//    publicable sin riesgo.
//
// 2. NO BORRA NADA. La version anterior hacia `deleteMany()` de sesiones y
//    usuarios antes de recrearlos. Eso servia cuando la base estaba vacia,
//    pero hoy hay movimientos reales apuntando a un usuario concreto: al
//    borrar la cuenta, su `usuarioId` se pondria a null y esos movimientos
//    perderian para siempre de quien fueron. Se actualiza por correo
//    electronico, que es unico, conservando el identificador.

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

const ROLES = ['ADMIN', 'OPERADOR'];

function leerUsuarios() {
  const crudo = process.env.USUARIOS_JSON;
  if (!crudo) {
    throw new Error(
      'Falta la variable de entorno USUARIOS_JSON.\n' +
      "Ejemplo: USUARIOS_JSON='[{\"email\":\"alguien@ejemplo.com\",\"nombre\":\"Alguien\",\"rol\":\"ADMIN\",\"password\":\"...\"}]'"
    );
  }

  let usuarios;
  try {
    usuarios = JSON.parse(crudo);
  } catch (e) {
    throw new Error(`USUARIOS_JSON no es un JSON valido: ${e.message}`);
  }
  if (!Array.isArray(usuarios) || usuarios.length === 0) {
    throw new Error('USUARIOS_JSON debe ser un arreglo con al menos un usuario.');
  }

  // Se valida todo ANTES de tocar la base: mas vale no ejecutar nada que
  // dejar media lista aplicada y la otra media no.
  usuarios.forEach((u, i) => {
    if (!u.email) throw new Error(`El usuario ${i + 1} no tiene email.`);
    if (!u.nombre) throw new Error(`${u.email}: falta el nombre.`);
    if (!ROLES.includes(u.rol)) throw new Error(`${u.email}: rol '${u.rol}' desconocido. Debe ser ${ROLES.join(' o ')}.`);
    if (!u.password || u.password.length < 8) {
      throw new Error(`${u.email}: la contrasena falta o tiene menos de 8 caracteres.`);
    }
  });

  const correos = usuarios.map((u) => u.email);
  const repetidos = correos.filter((c, i) => correos.indexOf(c) !== i);
  if (repetidos.length) throw new Error(`Correos repetidos en la lista: ${[...new Set(repetidos)].join(', ')}`);

  return usuarios;
}

async function main() {
  const usuarios = leerUsuarios();

  for (const u of usuarios) {
    const password = bcrypt.hashSync(u.password, 10);
    const existente = await prisma.usuario.findUnique({ where: { email: u.email } });

    await prisma.usuario.upsert({
      where: { email: u.email },
      update: { nombre: u.nombre, rol: u.rol, password },
      create: { email: u.email, nombre: u.nombre, rol: u.rol, password }
    });

    console.log(`${existente ? 'Actualizado' : 'Creado'}: ${u.email} (${u.rol})`);
  }

  console.log(`\nListo. ${usuarios.length} cuenta(s) procesada(s). No se borro ninguna.`);
}

main()
  .catch((e) => {
    console.error(`\nError: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
