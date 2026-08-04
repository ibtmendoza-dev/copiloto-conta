'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Navigation({ role }: { role?: string }) {
  const pathname = usePathname()

  return (
    <div className="h-[60px] bg-neutral-900 border-t border-neutral-800 flex items-center justify-around px-4 shrink-0">
      <Link 
        href="/"
        className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${pathname === '/' ? 'text-blue-500' : 'text-neutral-500 hover:text-neutral-300'}`}
      >
        <span className="text-xl">💬</span>
        <span className="text-[10px] font-medium tracking-wider uppercase">Copiloto</span>
      </Link>
      {role === 'ADMIN' && (
        <Link 
          href="/dashboard"
          className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${pathname === '/dashboard' ? 'text-blue-500' : 'text-neutral-500 hover:text-neutral-300'}`}
        >
          <span className="text-xl">📊</span>
          <span className="text-[10px] font-medium tracking-wider uppercase">Resumen</span>
        </Link>
      )}
    </div>
  )
}
