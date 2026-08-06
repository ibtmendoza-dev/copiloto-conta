// Guardia para los guiones que escriben en la base: obliga a reconocer CONTRA
// QUE base se va a ejecutar antes de dejarlos arrancar.
//
// POR QUE EXISTE. Estos guiones se ejecutan a mano con
// `node --env-file=.env scripts/loquesea.js`, y ese `.env` apunta a la base de
// PRODUCCION. Es decir, el modo de uso previsto es tambien el mas peligroso.
// Mientras la base solo tenia datos de prueba daba igual; desde el 2026-08-06
// el copiloto opera de verdad y un borrado equivocado se lleva contabilidad
// real, con una ventana de restauracion corta en el plan gratuito de Neon.
//
// COMO PROTEGE. Si la base es local (localhost o 127.0.0.1) no estorba: no hay
// nada que perder. Si es remota, exige que la variable CONFIRMAR_BASE traiga
// exactamente el nombre del servidor al que se va a conectar.
//
// Que haya que copiar el servidor no es un tramite vacio. Nadie puede alegar
// despues que creia estar apuntando a otra base, y una linea de comandos
// aprendida de memoria con el servidor de desarrollo NO arranca contra
// produccion: los nombres no coinciden y el guion se detiene.
//
// NO SUSTITUYE a las confirmaciones propias de cada guion (CONFIRMAR_BORRADO en
// reset-db.js). Son preguntas distintas: una es "seguro que quieres borrar", la
// otra es "seguro que quieres borrar AQUI".

const LOCALES = ['localhost', '127.0.0.1', '::1', ''];

/**
 * Descompone DATABASE_URL sin tocar las credenciales.
 *
 * Solo se leen servidor, puerto y nombre de la base. El usuario y la
 * contrasena van en la misma cadena y NO se extraen a proposito: este modulo
 * imprime lo que devuelve, y lo que no se lee no se puede filtrar por consola
 * ni acabar en el registro de una terminal.
 */
function describirBase(url) {
  const u = new URL(url);
  return {
    servidor: u.hostname,
    puerto: u.port || '5432',
    base: u.pathname.replace(/^\//, '') || '(sin nombre)'
  };
}

/**
 * Corta la ejecucion si la base remota no ha sido reconocida explicitamente.
 *
 * @param {string} accion  Que va a hacer el guion, para el mensaje. Ej:
 *                         'borrar todos los movimientos'.
 */
function confirmarBaseDeDatos(accion) {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      'Falta DATABASE_URL.\n' +
      'Estos guiones se ejecutan asi: node --env-file=.env scripts/<guion>.js'
    );
  }

  let destino;
  try {
    destino = describirBase(url);
  } catch {
    // Una DATABASE_URL que no se puede interpretar es motivo para NO seguir:
    // sin saber a donde apunta, la guardia no puede cumplir su unica funcion.
    throw new Error('DATABASE_URL no tiene el formato de una direccion valida. Revisa el .env');
  }

  if (LOCALES.includes(destino.servidor)) {
    console.log(`Base local (${destino.servidor}/${destino.base}). Adelante.`);
    return destino;
  }

  if (process.env.CONFIRMAR_BASE !== destino.servidor) {
    throw new Error(
      `Vas a ${accion} en una base REMOTA:\n\n` +
      `  servidor: ${destino.servidor}\n` +
      `  puerto:   ${destino.puerto}\n` +
      `  base:     ${destino.base}\n\n` +
      'Si es donde opera el negocio de verdad, lo que estes a punto de hacer NO\n' +
      'se puede deshacer. Comprueba que es la base que crees antes de seguir.\n\n' +
      'Para continuar, repite el servidor:\n\n' +
      `  CONFIRMAR_BASE=${destino.servidor} node --env-file=.env scripts/<guion>.js`
    );
  }

  console.log(`Base remota reconocida: ${destino.servidor}/${destino.base}`);
  return destino;
}

module.exports = { confirmarBaseDeDatos };
