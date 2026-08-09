// Pruebas de la acumulacion del dictado por voz.
//
// El caso que las origina es real: al dictar "compramos", la casilla se llenaba
// de "compramoscompramoscompramos...". Se atribuyo a un fallo del navegador en
// Android; no lo era. Era la lectura de `event.results`, que es acumulativo.
// Aqui se reproduce esa secuencia de eventos tal como la emite Chrome, para que
// el fallo tenga una prueba que lo detenga si vuelve.

import { describe, it, expect } from 'vitest';
import {
  iniciarDictado,
  reiniciarSesion,
  aplicarResultado,
  textoDictado,
  describirResultado,
  type EstadoDictado,
  type EventoReconocimiento
} from './dictado';

/** Construye un evento como los que entrega el navegador. */
function evento(
  resultIndex: number,
  ...resultados: Array<[string, boolean]>
): EventoReconocimiento {
  return {
    resultIndex,
    results: resultados.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } }))
  };
}

/** Aplica una secuencia de eventos y devuelve el ultimo texto visible. */
function reproducir(estado: EstadoDictado, eventos: EventoReconocimiento[]) {
  let actual = estado;
  let texto = textoDictado(estado);
  for (const e of eventos) {
    const paso = aplicarResultado(actual, e);
    actual = paso.estado;
    texto = paso.texto;
  }
  return { estado: actual, texto };
}

describe('aplicarResultado', () => {
  it('reemplaza el provisional en vez de acumularlo', () => {
    // Chrome reenvia el mismo resultado provisional corregido varias veces por
    // segundo. Este es el caso exacto que producia "compramoscompramos...".
    const { texto } = reproducir(iniciarDictado(''), [
      evento(0, ['com', false]),
      evento(0, ['compra', false]),
      evento(0, ['compramos', false]),
      evento(0, ['compramos', false])
    ]);

    expect(texto).toBe('compramos');
  });

  it('acumula las frases cerradas una sola vez', () => {
    const { texto } = reproducir(iniciarDictado(''), [
      evento(0, ['compramos verduras', true]),
      evento(1, ['compramos verduras', true], ['por ocho', false]),
      evento(1, ['compramos verduras', true], ['por ochocientos pesos', true])
    ]);

    expect(texto).toBe('compramos verduras por ochocientos pesos');
  });

  it('ignora un resultado final que el navegador reemite', () => {
    // Chrome en Android vuelve a mandar resultados ya cerrados. Sin la cuenta
    // propia de resultados cerrados, la frase se pegaria dos veces.
    const { texto } = reproducir(iniciarDictado(''), [
      evento(0, ['compramos verduras', true]),
      evento(0, ['compramos verduras', true]),
      evento(0, ['compramos verduras', true])
    ]);

    expect(texto).toBe('compramos verduras');
  });

  it('conserva lo que el usuario escribio a mano antes de dictar', () => {
    const { texto } = reproducir(iniciarDictado('Nota:'), [
      evento(0, ['compramos verduras', true])
    ]);

    expect(texto).toBe('Nota: compramos verduras');
  });

  it('no pierde ni duplica lo dictado cuando la sesion se reinicia', () => {
    // En cada pausa el navegador cierra la sesion y hay que reabrirla. La nueva
    // vuelve a numerar desde 0, asi que el contador de cerrados se reinicia
    // pero el texto no.
    const primera = reproducir(iniciarDictado(''), [
      evento(0, ['compramos verduras', true])
    ]);
    expect(primera.texto).toBe('compramos verduras');

    const segunda = reproducir(reiniciarSesion(primera.estado), [
      evento(0, ['por ocho', false]),
      evento(0, ['por ochocientos pesos', true])
    ]);

    expect(segunda.texto).toBe('compramos verduras por ochocientos pesos');
  });

  it('no se rompe con un evento vacio o sin resultados', () => {
    const estado = iniciarDictado('Nota:');

    expect(aplicarResultado(estado, { resultIndex: 0, results: [] }).texto).toBe('Nota:');
    expect(aplicarResultado(estado, { resultIndex: 0 }).texto).toBe('Nota:');
    expect(aplicarResultado(estado, { resultIndex: 0, results: null }).texto).toBe('Nota:');
  });

  it('descarta huecos sin transcripcion sin cortar el resto', () => {
    const { texto } = reproducir(iniciarDictado(''), [
      { resultIndex: 0, results: [undefined, { isFinal: true, 0: { transcript: 'verduras' } }] }
    ]);

    expect(texto).toBe('verduras');
  });
});

describe('describirResultado', () => {
  it('resume el evento sin perder el indice, el estado ni el texto', () => {
    const linea = describirResultado(
      evento(1, ['compramos', true], ['cinco kilos', false])
    );

    expect(linea).toBe('desde 1 de 2 0F:"compramos" 1p:"cinco kilos"');
  });

  it('marca los eventos que se descartan por venir despues del envio', () => {
    const linea = describirResultado(evento(0, ['compramos', true]), true);

    expect(linea).toBe('(descartado) desde 0 de 1 0F:"compramos"');
  });

  it('aguanta un evento sin resultados', () => {
    expect(describirResultado({ resultIndex: 0 })).toBe('desde 0 de 0');
  });
});

describe('la lectura anterior, para dejar constancia del fallo', () => {
  // Reproduccion literal del codigo que estaba en page.tsx antes del arreglo:
  // recorria `event.results` desde 0 y pegaba todo su contenido, sin separador.
  const comoEstaba = (eventos: EventoReconocimiento[]) => {
    let casilla = '';
    for (const e of eventos) {
      let transcripcion = '';
      const resultados = e.results ?? [];
      for (let i = 0; i < resultados.length; i++) {
        transcripcion += resultados[i]![0].transcript;
      }
      casilla = transcripcion;
    }
    return casilla;
  };

  it('pegaba la lista acumulada entera y sin separar', () => {
    // Una frase que el reconocedor entrega en tres tramos. La lista crece, y
    // los tramos ya cerrados siguen en ella para siempre.
    const eventos = [
      evento(0, ['compramos', true]),
      evento(1, ['compramos', true], ['verduras', true]),
      evento(2, ['compramos', true], ['verduras', true], ['por ochocientos', true])
    ];

    expect(comoEstaba(eventos)).toBe('compramosverduraspor ochocientos');
    expect(reproducir(iniciarDictado(''), eventos).texto).toBe(
      'compramos verduras por ochocientos'
    );
  });

  it('repetia lo ya cerrado cuando el navegador reemitia la lista', () => {
    // Esto es lo que se veia en la captura: la misma palabra multiplicada.
    const eventos = [
      evento(0, ['compramos', true], ['compramos', false]),
      evento(0, ['compramos', true], ['compramos', true], ['compramos', false])
    ];

    expect(comoEstaba(eventos)).toBe('compramoscompramoscompramos');
  });
});
