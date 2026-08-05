'use client';

import { deleteMovimiento } from '@/app/actions';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function DeleteMovimientoButton({ id }: { id: string }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm('¿Estás seguro de eliminar este registro?')) return;
    
    setIsDeleting(true);
    const res = await deleteMovimiento(id);
    
    if (res?.success) {
      router.refresh();
    } else {
      alert(res?.error || 'No se pudo eliminar');
      setIsDeleting(false);
    }
  };

  return (
    <button 
      onClick={handleDelete} 
      disabled={isDeleting}
      className="text-xs text-red-500 hover:text-red-400 bg-red-950/30 px-2 py-1 rounded transition-colors disabled:opacity-50"
      title="Eliminar registro"
    >
      {isDeleting ? '...' : 'Borrar'}
    </button>
  );
}
