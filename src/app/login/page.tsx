import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import LoginForm from './LoginForm'

// Envoltura de servidor sobre el formulario. Es aqui, y no en el intermediario,
// donde se decide si alguien ya esta dentro: `getSession()` consulta la base y
// distingue una sesion viva de una galleta huerfana. El intermediario, en el
// entorno Edge, no puede hacer esa diferencia.
//
// Con la galleta invalida NO se redirige: se deja ver el formulario. Ese es el
// punto -- entrar de nuevo es la salida del limbo, y `createSession` sobrescribe
// la galleta vieja al identificarse, sin necesidad de borrarla antes.
export default async function LoginPage() {
  const session = await getSession()

  if (session) {
    redirect('/')
  }

  return <LoginForm />
}
