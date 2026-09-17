'use client';

// Casilla "insumo" por artículo en el historial (2026-09-16). Cambiarla
// corrige la marca que puso la IA al capturar y vuelve a sincronizar la
// entrada de almacén en la plataforma de producción: si el movimiento se
// queda sin insumos, la entrada se retira; si gana el primero, se crea.

import { setConceptoInsumo } from '@/app/actions';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function InsumoCheckbox({ conceptoId, esInsumo }: { conceptoId: string; esInsumo: boolean }) {
  const router = useRouter();
  const [valor, setValor] = useState(esInsumo);
  const [guardando, setGuardando] = useState(false);

  const cambiar = async (nuevo: boolean) => {
    setValor(nuevo);
    setGuardando(true);
    const res = await setConceptoInsumo(conceptoId, nuevo);
    setGuardando(false);
    if (res?.success) {
      if (res.aviso) alert(res.aviso);
      router.refresh();
    } else {
      setValor(!nuevo);
      alert(res?.error || 'No se pudo cambiar la marca');
    }
  };

  return (
    <label className={`inline-flex items-center gap-1 text-xs select-none ${valor ? 'text-emerald-400' : 'text-neutral-500'} ${guardando ? 'opacity-50' : ''}`} title="Insumo del negocio: viaja a la plataforma de producción">
      <input
        type="checkbox"
        checked={valor}
        disabled={guardando}
        onChange={(e) => cambiar(e.target.checked)}
        className="accent-emerald-500"
      />
      insumo
    </label>
  );
}
