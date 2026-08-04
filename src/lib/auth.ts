import { cookies } from 'next/headers';
import { prisma } from './prisma';

export async function getSession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get('copiloto_session')?.value;
  
  if (!sessionId) return null;
  
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { usuario: {
      select: { id: true, nombre: true, email: true, rol: true }
    }}
  });
  
  if (!session) return null;
  
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: sessionId } });
    return null;
  }
  
  return session;
}

export async function createSession(usuarioId: string) {
  // Expirar en 30 días
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  
  const session = await prisma.session.create({
    data: {
      usuarioId,
      expiresAt,
    }
  });
  
  const cookieStore = await cookies();
  cookieStore.set('copiloto_session', session.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt
  });
  
  return session;
}

export async function destroySession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get('copiloto_session')?.value;
  
  if (sessionId) {
    try {
      await prisma.session.delete({ where: { id: sessionId } });
    } catch(e) {}
  }
  
  cookieStore.delete('copiloto_session');
}
