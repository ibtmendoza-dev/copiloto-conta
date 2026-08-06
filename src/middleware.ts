import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// El intermediario corre en el entorno Edge, donde Prisma no funciona: aqui NO
// se puede consultar la base de datos. Por eso solo puede mirar si la galleta
// existe, no si la sesion que representa sigue siendo valida.
//
// De ahi la regla: este archivo solo aplica el atajo que NO puede equivocarse
// -- sin galleta no hay sesion posible, a iniciar sesion. La comprobacion de
// verdad, contra la base, la hacen las pantallas con `getSession()`.
//
// Habia una segunda regla, "con galleta no puedes ver /login", que se quito a
// proposito (2026-08-06). Presuponia que tener galleta es estar dentro, y
// cuando la sesion desaparecia de la base dejaba al operador encerrado: la
// aplicacion le respondia "No autorizado" a todo, y al intentar volver a
// entrar el intermediario lo rebotaba de /login al inicio. Sin forma de salir
// salvo borrar la galleta a mano en el navegador.
//
// Que un operador ya identificado vea la pantalla de inicio de sesion lo evita
// ahora /login, que sí puede consultar la base y decidir con la verdad.
export function middleware(request: NextRequest) {
  const sessionId = request.cookies.get('copiloto_session')?.value

  const isLoginPage = request.nextUrl.pathname.startsWith('/login')

  if (!sessionId && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
