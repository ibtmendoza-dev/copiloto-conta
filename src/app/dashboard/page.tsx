import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import DeleteMovimientoButton from '@/components/DeleteMovimientoButton'

export default async function DashboardPage(props: { searchParams: Promise<{ contexto?: string }> }) {
  const session = await getSession();
  // Dos casos distintos que antes acababan los dos en '/'. Sin sesion valida,
  // mandar al inicio dejaba al operador en el limbo: el chat cargaba y solo
  // fallaba al enviar un mensaje. La salida correcta es identificarse de nuevo.
  if (!session) {
    redirect('/login');
  }
  if (session.usuario.rol !== 'ADMIN') {
    redirect('/');
  }

  const searchParams = await props.searchParams;
  const currentContexto = searchParams.contexto === 'PERSONAL' ? 'PERSONAL' : 'NEGOCIO';

  // 1. Obtener todos los movimientos del contexto
  const movimientos = await prisma.movimiento.findMany({
    where: { contexto: currentContexto },
    orderBy: { fechaOcurrencia: 'desc' }
  })

  // 2. Calcular KPIs
  const totalGastos = movimientos
    .filter(m => m.tipo === 'GASTO')
    .reduce((sum, m) => sum + Number(m.importe), 0)

  const totalIvaAcreditable = movimientos
    .filter(m => m.tipo === 'GASTO')
    .reduce((sum, m) => sum + Number(m.iva || 0), 0)

  // 3. Agrupar por Categorías
  const gastosPorCategoria = movimientos
    .filter(m => m.tipo === 'GASTO' && m.categoria)
    .reduce((acc, m) => {
      const cat = m.categoria!
      acc[cat] = (acc[cat] || 0) + Number(m.importe)
      return acc
    }, {} as Record<string, number>)

  const maxCatValue = Math.max(...Object.values(gastosPorCategoria), 1)

  return (
    <div className="flex-1 flex flex-col h-full bg-neutral-950 text-neutral-100 overflow-y-auto p-4 md:p-8">
      <header className="mb-8 flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            Resumen Financiero
          </h1>
          <p className="text-neutral-400 text-sm mt-1">Vista gerencial de tus movimientos</p>
        </div>
        
        <div className="flex bg-neutral-900 border border-neutral-800 rounded-lg p-1">
          <Link href="/dashboard?contexto=NEGOCIO" className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${currentContexto === 'NEGOCIO' ? 'bg-blue-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'}`}>
            🏢 Negocio
          </Link>
          <Link href="/dashboard?contexto=PERSONAL" className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${currentContexto === 'PERSONAL' ? 'bg-indigo-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'}`}>
            🏠 Personal
          </Link>
        </div>
      </header>

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex flex-col">
          <span className="text-neutral-400 text-xs font-medium uppercase tracking-wider mb-1">Total Gastos</span>
          <span className="text-2xl font-bold">${totalGastos.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex flex-col">
          <span className="text-neutral-400 text-xs font-medium uppercase tracking-wider mb-1 text-green-400">IVA a Favor</span>
          <span className="text-2xl font-bold text-green-400">${totalIvaAcreditable.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
        </div>
      </section>

      {/* Distribución por Categorías */}
      <section className="mb-8 bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400 mb-4">Distribución de Gastos</h2>
        <div className="space-y-4">
          {Object.entries(gastosPorCategoria)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, amount]) => {
              const percent = (amount / maxCatValue) * 100
              const isInventory = cat === 'INVENTARIO'
              return (
                <div key={cat}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className={`font-medium ${isInventory ? 'text-blue-400' : 'text-neutral-200'}`}>
                      {cat} {isInventory && '(Sincronizable)'}
                    </span>
                    <span className="text-neutral-400">${amount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="h-2 w-full bg-neutral-800 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${isInventory ? 'bg-blue-500' : 'bg-neutral-600'}`} 
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              )
            })}
          {Object.keys(gastosPorCategoria).length === 0 && (
            <p className="text-neutral-500 text-sm">No hay gastos categorizados aún.</p>
          )}
        </div>
      </section>

      {/* Últimos Movimientos */}
      <section className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 flex-1">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400 mb-4">Últimos Movimientos</h2>
        <div className="space-y-3">
          {movimientos.slice(0, 5).map(mov => (
            <div key={mov.id} className="flex justify-between items-center p-3 rounded-lg border border-neutral-800/50 bg-neutral-800/30">
              <div className="flex flex-col">
                <span className="font-medium text-sm">{mov.categoria || 'Sin Categoría'}</span>
                <span className="text-xs text-neutral-500">
                  {mov.fechaOcurrencia.toLocaleDateString()} • {mov.tasaIva === '0%' ? 'Tasa 0%' : 'Con IVA'}
                </span>
              </div>
              <div className="flex items-center space-x-3">
                <span className="font-bold text-sm">
                  {mov.tipo === 'GASTO' ? '-' : '+'}${Number(mov.importe).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                </span>
                <DeleteMovimientoButton id={mov.id} />
              </div>
            </div>
          ))}
          {movimientos.length === 0 && (
            <p className="text-neutral-500 text-sm">No hay movimientos registrados.</p>
          )}
        </div>
      </section>
    </div>
  )
}
