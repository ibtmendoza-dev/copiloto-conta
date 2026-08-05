import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import DeleteMovimientoButton from '@/components/DeleteMovimientoButton'

export default async function HistorialPage() {
  const session = await getSession();
  if (!session) {
    redirect('/');
  }

  // Límite de las últimas 24 horas
  const hace24Horas = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const movimientos = await prisma.movimiento.findMany({
    where: { 
      usuarioId: session.usuario.id,
      createdAt: { gte: hace24Horas }
    },
    orderBy: { createdAt: 'desc' },
    include: { conceptos: true }
  });

  return (
    <div className="flex flex-col h-full bg-neutral-950 text-neutral-100 overflow-y-auto">
      <header className="h-16 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-md flex items-center px-4 sticky top-0 z-10">
        <Link href="/" className="text-neutral-400 hover:text-white p-2 rounded-lg hover:bg-neutral-800 transition-colors mr-2">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h2 className="text-lg font-medium text-neutral-200">Mi Historial de Hoy</h2>
          <p className="text-xs text-neutral-500">Registros de las últimas 24 horas</p>
        </div>
      </header>

      <main className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto w-full">
        {movimientos.length === 0 ? (
          <div className="text-center p-8 bg-neutral-900 border border-neutral-800 rounded-2xl">
            <p className="text-neutral-400">No has registrado ningún movimiento hoy.</p>
          </div>
        ) : (
          movimientos.map(mov => (
            <div key={mov.id} className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex justify-between items-start">
                <div>
                  <span className="inline-block px-2 py-1 bg-neutral-800 text-xs font-medium text-neutral-300 rounded mb-2">
                    {mov.tipo} • {mov.categoria || 'Sin categoría'}
                  </span>
                  <p className="text-neutral-200 text-sm whitespace-pre-wrap">{mov.descripcionOriginal}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="font-bold text-lg text-white">
                    ${Number(mov.importe).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                  </span>
                  <DeleteMovimientoButton id={mov.id} />
                </div>
              </div>

              {mov.conceptos.length > 0 && (
                <div className="mt-2 pt-3 border-t border-neutral-800">
                  <p className="text-xs font-semibold text-neutral-500 mb-2 uppercase tracking-wider">Artículos Capturados</p>
                  <ul className="space-y-1">
                    {mov.conceptos.map(cat => (
                      <li key={cat.id} className="text-sm text-neutral-400 flex justify-between">
                        <span>{Number(cat.cantidad)}x {cat.descripcion}</span>
                        <span>${Number(cat.importeTotal).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))
        )}
      </main>
    </div>
  )
}
