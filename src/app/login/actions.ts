'use server'

import { prisma } from '@/lib/prisma'
import { createSession } from '@/lib/auth'
import bcrypt from 'bcryptjs'
import { redirect } from 'next/navigation'

export async function loginAction(prevState: any, formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  
  if (!email || !password) {
    return { error: 'Por favor ingresa email y contraseña' }
  }
  
  const user = await prisma.usuario.findUnique({
    where: { email }
  })
  
  if (!user) {
    return { error: 'Credenciales inválidas' }
  }
  
  const isValid = await bcrypt.compare(password, user.password)
  
  if (!isValid) {
    return { error: 'Credenciales inválidas' }
  }
  
  await createSession(user.id)
  
  // Si todo está bien, redirigimos
  redirect('/')
}

export async function logoutAction() {
  await destroySession()
  redirect('/login')
}
