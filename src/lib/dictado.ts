// Acumulacion del texto dictado por voz (Web Speech API).
//
// Esta logica vive aparte de la pantalla porque aqui estuvo el fallo que
// multiplicaba el texto en la casilla ("compramoscompramoscompramos"):
// `event.results` es acumulativo. En cada evento el navegador reenvia todos
// los resultados de la sesion, no solo el nuevo, y ademas reenvia el resultado
// provisional corregido varias veces por segundo. El codigo anterior recorria
// la lista desde 0 y reescribia la casilla con la concatenacion completa, asi
// que cada palabra reaparecia tantas veces como eventos llegaran.
//
// Lo correcto es leer solo desde `event.resultIndex` — el indice del primer
// resultado que cambio — y llevar la cuenta propia de que resultados ya se
// dieron por cerrados, porque Chrome en Android reemite resultados finales que
// ya habia entregado.
//
// Al ser puro, el fallo se reproduce en `dictado.test.ts` sin microfono.

/** Un resultado del reconocedor, tal como lo entrega el navegador. */
export interface ResultadoReconocimiento {
  readonly isFinal: boolean
  readonly 0: { readonly transcript: string }
}

/** El evento `onresult`, reducido a lo que de verdad se lee de el. */
export interface EventoReconocimiento {
  readonly resultIndex?: number
  readonly results?: ArrayLike<ResultadoReconocimiento | undefined> | null
}

export interface EstadoDictado {
  /** Lo que el usuario habia escrito a mano antes de encender el microfono. */
  readonly base: string
  /** Las frases que el reconocedor ya cerro durante este dictado. */
  readonly finalizado: string
  /**
   * Cuantos resultados de la sesion actual del reconocedor ya se contaron como
   * finales. Sirve para ignorar los que Android reemite.
   */
  readonly resultadosCerrados: number
  /** El ultimo texto final que se agrego. Se usa para detectar el bug de Android. */
  readonly ultimoFinal: string
}

/** Empieza un dictado anclado al texto que ya hubiera en la casilla. */
export function iniciarDictado(base: string): EstadoDictado {
  return { base: base.trim(), finalizado: "", resultadosCerrados: 0, ultimoFinal: "" }
}

/**
 * El navegador cierra la sesion en cada pausa y hay que reabrirla. La sesion
 * nueva vuelve a numerar sus resultados desde 0, pero lo ya dictado se conserva.
 */
export function reiniciarSesion(estado: EstadoDictado): EstadoDictado {
  return { ...estado, resultadosCerrados: 0, ultimoFinal: "" }
}

/** El texto que debe verse en la casilla si el dictado terminara ahora. */
export function textoDictado(estado: EstadoDictado): string {
  return unir(estado.base, estado.finalizado)
}

/**
 * Aplica un evento del reconocedor y devuelve el estado nuevo junto con el
 * texto que debe mostrarse. Los resultados provisionales se pintan pero no se
 * acumulan: el siguiente evento los reemplaza.
 */
export function aplicarResultado(
  estado: EstadoDictado,
  evento: EventoReconocimiento
): { estado: EstadoDictado; texto: string } {
  const resultados = evento.results
  if (!resultados || resultados.length === 0) {
    return { estado, texto: textoDictado(estado) }
  }

  const desde = Math.min(Math.max(evento.resultIndex ?? 0, 0), resultados.length)
  let finalizado = estado.finalizado
  let cerrados = estado.resultadosCerrados
  let ultimoFinal = estado.ultimoFinal
  let provisional = ""

  for (let i = desde; i < resultados.length; i++) {
    const resultado = resultados[i]
    if (!resultado || !resultado[0]) continue
    const transcripcion = resultado[0].transcript.trim()

    // Android inyecta resultados finales vacios que estropearian ultimoFinal
    if (!transcripcion) {
      if (resultado.isFinal && i >= cerrados) cerrados = i + 1
      continue
    }

    if (resultado.isFinal) {
      if (i >= cerrados) {
        // Bug de Android Chrome: emite la frase creciente como multiples
        // resultados finales nuevos. Si la nueva transcripcion empieza con
        // la anterior, es una expansion, no una frase nueva. Y a veces
        // emite duplicados exactos.
        if (transcripcion === ultimoFinal) {
          // Ignoramos el duplicado exacto de Android
        } else if (ultimoFinal && transcripcion.startsWith(ultimoFinal)) {
          finalizado = finalizado.slice(0, finalizado.length - ultimoFinal.length) + transcripcion
        } else {
          finalizado = unir(finalizado, transcripcion)
        }
        ultimoFinal = transcripcion
        cerrados = i + 1
      }
    } else {
      provisional = transcripcion // Solo nos interesa el ultimo estado provisional de la frase
    }
  }

  const nuevo: EstadoDictado = { ...estado, finalizado, resultadosCerrados: cerrados, ultimoFinal }
  return { estado: nuevo, texto: unir(nuevo.base, nuevo.finalizado, provisional) }
}

/**
 * Resume un evento del reconocedor en una linea legible, para el registro que
 * se muestra en la aplicacion. Es temporal: existe para ver que entrega el
 * telefono de verdad en lugar de deducirlo.
 */
export function describirResultado(evento: EventoReconocimiento, descartado = false): string {
  const resultados = evento.results
  const total = resultados ? resultados.length : 0
  const piezas: string[] = []

  for (let i = 0; i < total; i++) {
    const resultado = resultados![i]
    if (!resultado || !resultado[0]) {
      piezas.push(`${i}:vacio`)
      continue
    }
    piezas.push(`${i}${resultado.isFinal ? 'F' : 'p'}:"${resultado[0].transcript}"`)
  }

  const cabecera = `desde ${evento.resultIndex ?? 0} de ${total}`
  return `${descartado ? '(descartado) ' : ''}${cabecera} ${piezas.join(' ')}`.trim()
}

function unir(...partes: string[]): string {
  return partes
    .map((parte) => parte.trim())
    .filter(Boolean)
    .join(" ")
}
