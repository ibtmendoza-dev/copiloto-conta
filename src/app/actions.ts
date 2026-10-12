'use server'

import { prisma } from '@/lib/prisma'
import { generateObject } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { getSession } from '@/lib/auth'
import { dbFirestore } from '@/lib/firebase'
import { put } from '@vercel/blob'
import { REGLAS_INSUMO, debeInyectar, articulosParaAlmacen, payloadEntradaAlmacen, accionDePuente } from '@/lib/insumos'
import { COLECCION_ESPEJO, debeEspejar, payloadMovimientoFinanzas } from '@/lib/espejo.mjs'
import { NINGUNA, NUEVO, COLECCIONES_TIPOS, COLECCION_TIPOS_COPILOTO, hoyEnMexico, catalogoDePropuesta, hayCatalogo, hayTipos, instruccionDePropuesta, normalizarPropuesta, textoDePropuesta, datosDeTipoNuevo } from '@/lib/propuesta.mjs'
import { articulosSinIdentificar, preguntaPorDetalle } from '@/lib/detalle'

export async function createMovimiento(formData: { inputOriginal: string, imageBase64?: string, clientMessageId?: string }) {
  try {
    const session = await getSession();
    if (!session) throw new Error('No autorizado');

    const avisos: { tipo: string, motivo: string }[] = [];
    let fileUrl: string | null = null;
    let base64Content: string | null = null;
    let mediaType: string = 'image/jpeg';

    const descripcionOriginal = formData.inputOriginal?.trim()
      || (formData.imageBase64 ? '(Capturado desde la imagen del comprobante, sin texto)' : '');

    if (formData.imageBase64) {
      base64Content = formData.imageBase64.split(',')[1];
      const tipoDeclarado = formData.imageBase64.match(/^data:([^;,]+)[;,]/)?.[1];
      if (tipoDeclarado) mediaType = tipoDeclarado;
    }

    const messagesContent: any[] = [
      { type: 'text', text: formData.inputOriginal }
    ];

    if (base64Content) {
      messagesContent.push({ type: 'file', mediaType, data: base64Content });
    }

    // La propuesta para Costos (2026-10-12, src/lib/propuesta.mjs): el catálogo
    // de cuentas y sucursales de la plataforma va en la instrucción. Si no se
    // puede leer, la captura sigue igual que antes, sin propuesta.
    const catalogo = await cargarCatalogo();
    const hoy = hoyEnMexico();
    const conPropuesta = hayCatalogo(catalogo);
    const idsCuenta: [string, ...string[]] = [NINGUNA, ...catalogo.cuentas.map((c: { id: string }) => c.id)];
    const idsPdv: [string, ...string[]] = [NINGUNA, ...catalogo.pdvs.map((p: { id: string }) => p.id)];
    // Los tipos de gasto (2026-10-12, incremento 9): la lista de la caja y la
    // del Copiloto, más "nuevo" para pedir uno.
    const conTipos = hayTipos(catalogo);
    const idsTipo: [string, ...string[]] = [NINGUNA, NUEVO, ...catalogo.tipos.map((t: { id: string }) => t.id)];

    const { object } = await generateObject({
      model: google('gemini-3.6-flash'), // Versión 2026
      maxRetries: 0, // Desactivar reintentos automáticos (evita quemar cuota en errores 429)
      system: `Eres un asistente de extracción financiera experto. 
      Tu objetivo es analizar un mensaje desestructurado y extraer los datos duros de un "Movimiento Económico".
      Si recibes una imagen de un ticket o factura, actúa como un OCR inteligente. Extrae el importe total, la fecha, el proveedor y fusiónalo con las instrucciones del usuario.
      Reglas estrictas para el tipo:
      - Si representa salida de dinero para operar -> "GASTO"
      - Si representa entrada de dinero -> "VENTA"
      Reglas estrictas para el importe y el IVA:
      - Extrae el Total (importe), el Subtotal y el IVA. 
      - REGLA DE ORO FISCAL 1: Si la imagen es una Factura (CFDI), extrae los montos exactos tal cual vienen impresos.
      - REGLA DE ORO FISCAL 2: Si NO hay imagen de CFDI y el usuario NO menciona la palabra "factura", asume que el gasto no es deducible: IVA es nulo/0, Subtotal es nulo/0, y toma el Total como absoluto.
      - REGLA DE ORO FISCAL 3 (CALCULO CIEGO): Si el usuario dice que "es con factura" o "tiene IVA" pero NO hay imagen, ESTÁS OBLIGADO a calcular el Subtotal y el IVA matemáticamente.
      
      REGLAS ESTRICTAS DE DESGLOSE DE ARTÍCULOS (SKUs):
      - ESTÁS OBLIGADO a llenar el arreglo 'articulos' siempre que el usuario mencione productos físicos o servicios. NUNCA lo dejes vacío.
      - Si el usuario menciona múltiples productos de diferentes proveedores o naturalezas, sepáralos en múltiples 'movimientos'. Si los compró en la misma tienda, ponlos como múltiples 'articulos' dentro de un solo 'movimiento'.
      - HAZ LA MATEMÁTICA CORRECTA: Si el usuario dice "2 bidones a 640 cada uno", la 'cantidad' es 2, 'precioUnitario' es 640, y el 'importeTotal' de esa línea es 1280.
      - El 'importe' del movimiento DEBE coincidir con la suma exacta de los 'importeTotal' de todos sus articulos.
      - Si no puedes saber qué es un artículo (el ticket no lo dice o no se lee, y el mensaje tampoco), NO inventes un nombre ni pongas uno genérico como "Insumo / Producto": escribe lo que sí se lea y marca 'identificado' en false. El sistema le preguntará al usuario.
      - Lo que el usuario escriba manda sobre lo que leas en el ticket: si dice qué es un artículo, cuántos fueron o a cuánto, usa lo que dice.
      
      TABLA DE EXCEPCIONES FISCALES (MÉXICO) PARA CALCULO CIEGO:
      Antes de calcular el IVA a ciegas, clasifica los "articulos" que identificaste contra esta tabla:
      1. Gasolina/Combustible: Contiene IEPS. Aproxima así: Subtotal = Total * 0.85, IVA = Total * 0.13. (Tasa: "16% Especial")
      2. Alimentos frescos (frutas, verduras, carnes), Medicinas y Libros: Tasa 0% (IVA = 0, Subtotal = Total. Tasa: "0%")
      3. Honorarios médicos: Exentos (IVA = 0, Subtotal = Total. Tasa: "EXENTO")
      4. Otros productos generales: Tasa estándar 16% (Total / 1.16 = Subtotal, Total - Subtotal = IVA. Tasa: "16%")
      
      REGLAS DE CONTEXTO (NEGOCIO VS PERSONAL):
      - Todo movimiento pertenece a un 'contexto'. Puede ser 'NEGOCIO' o 'PERSONAL'.
      - Si el usuario dice que es para la casa, gasto familiar, personal, o algo que claramente no es de la empresa, márcalo como 'PERSONAL'.
      - Si no dice nada, o si es materia prima, mantenimiento de la empresa, inventario, etc., márcalo por defecto como 'NEGOCIO'.

      REGLAS DE CATEGORÍA PARA COMPRAS DEL NEGOCIO:
      - 'INVENTARIO' cuando TODOS los artículos son insumos del negocio (ingredientes, empaques, desechables, consumibles de cocina), vengan de un proveedor o de un supermercado.
      - 'ALIMENTOS' solo para comida consumida por las personas (tortas, refrescos, comidas del personal), no para ingredientes que se compran para producir.
      - Si el ticket mezcla insumos con otras cosas, deja la categoría que domine y marca cada artículo con 'esInsumo'.

      ${REGLAS_INSUMO}
      ${conPropuesta ? instruccionDePropuesta(catalogo, hoy) : ''}`,
      messages: [
        {
          role: 'user',
          content: messagesContent
        }
      ],
      schema: z.object({
        movimientos: z.array(z.object({
          tipo: z.string().describe('El tipo de movimiento deducido, preferiblemente GASTO o VENTA.'),
          importe: z.number().describe('El valor monetario TOTAL del movimiento (incluyendo impuestos).'),
          subtotal: z.number().optional().describe('El valor antes de impuestos, si aplica.'),
          iva: z.number().optional().describe('El monto del impuesto (IVA).'),
          tasaIva: z.string().optional().describe('La tasa de IVA aplicada, ej. "16%", "8%", "0%", o "EXENTO".'),
          contexto: z.enum(['NEGOCIO', 'PERSONAL']).describe('El contexto o entorno del gasto. NEGOCIO por defecto, PERSONAL si es explícitamente familiar o de casa.'),
          categoria: z.enum(['ALIMENTOS', 'TRANSPORTE', 'SALUD', 'OFICINA', 'INVENTARIO', 'HONORARIOS', 'MANTENIMIENTO', 'OTROS']).describe('Categoriza el gasto según su naturaleza.'),
          contraparte: z.string().optional().describe('El nombre de la tienda, proveedor o cliente.'),
          sucursal: (conPropuesta ? z.enum(idsPdv) : z.string()).optional().describe(`El id de la sucursal solo si el mensaje la nombra; si no, "${NINGUNA}".`),
          fechaGasto: z.string().optional().describe('El día en que se hizo el gasto, AAAA-MM-DD, solo si el mensaje o el ticket lo dicen. Vacío si no.'),
          articulos: z.array(z.object({
            cantidad: z.number().describe('La cantidad adquirida del producto.'),
            descripcion: z.string().describe('El nombre o descripción del producto o servicio.'),
            identificado: z.boolean().describe('true si sabes qué es el artículo porque el ticket o el mensaje lo dicen; false si no se alcanza a leer y tendrías que adivinarlo.'),
            precioUnitario: z.number().describe('El precio por unidad.'),
            importeTotal: z.number().describe('El importe total por esta línea (cantidad * precio unitario).'),
            esInsumo: z.boolean().describe('true si el artículo es un insumo del negocio (ingrediente, empaque, desechable, consumible de cocina); false si es propina, descuento, transporte, comida consumida, equipo, servicio o algo para la casa.'),
            cuentaCosto: (conPropuesta ? z.enum(idsCuenta) : z.string()).optional().describe(`El id de la cuenta de costo del artículo, de la lista; "${NINGUNA}" si ninguna le queda clara.`),
            tipoGasto: (conTipos ? z.enum(idsTipo) : z.string()).optional().describe(`El id del tipo de gasto del artículo, de la lista; "${NUEVO}" si ninguno le queda; "${NINGUNA}" en lo personal.`),
            tipoNuevo: z.string().optional().describe(`Solo con "${NUEVO}": el nombre corto y general del tipo nuevo, de una a tres palabras.`)
          })).describe('OBLIGATORIO: Arreglo de artículos adquiridos. NUNCA lo omitas. Si no hay productos, devuelve un arreglo vacío [].'),
        })).describe('Lista de movimientos económicos identificados en el mensaje.')
      }),
    });

    // === VALIDACIÓN ESTRICTA DE PRECIO ===
    // Evitamos guardar registros en $0 que contaminen la contabilidad
    for (const mov of object.movimientos) {
      if (!mov.importe || mov.importe <= 0) {
        const itemNames = mov.articulos?.map((a: any) => a.descripcion).join(', ') || 'este movimiento';
        return { 
          success: false, 
          error: `No detecté el precio de "${itemNames}". Por favor, intenta de nuevo especificando cuánto costó.` 
        };
      }
    }

    // === LO QUE NO SE SABE QUÉ ES (2026-10-12, src/lib/detalle.ts) ===
    // No se guarda nada: se le pregunta al usuario, y la pantalla deja la foto
    // adjunta para que su respuesta viaje con ella.
    const faltan = articulosSinIdentificar(object.movimientos);
    if (faltan.length > 0) {
      return { success: false, faltaDetalle: true, pregunta: preguntaPorDetalle(faltan, { conImagen: Boolean(base64Content) }) };
    }

    // El comprobante se sube hasta aquí, cuando ya se va a guardar: lo que se
    // devuelve antes no deja imágenes huérfanas en Vercel Blob.
    if (base64Content) {
      try {
        const extension = (mediaType.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '');
        const blob = await put(
          `comprobantes/${session.usuario.id}/${Date.now()}.${extension}`,
          Buffer.from(base64Content, 'base64'),
          { access: 'private', contentType: mediaType, addRandomSuffix: true }
        );
        fileUrl = blob.url;
      } catch (blobError: any) {
        console.error("❌ Error al subir el comprobante a Vercel Blob:", blobError);
        avisos.push({
          tipo: 'COMPROBANTE',
          motivo: `No se pudo guardar la imagen del comprobante: ${blobError?.message ?? String(blobError)}`
        });
      }
    }

    const savedMovimientos = [];
    // Lo propuesto para Costos, en texto para el chat, uno por movimiento guardado.
    const propuestas: string[] = [];
    // Los tipos nuevos ya creados en esta captura: dos artículos con el mismo
    // tipo nuevo crean uno solo.
    const tiposCreados = new Set<string>();

    let index = 0;
    for (const mov of object.movimientos) {
      const isOperador = session.usuario.rol === 'OPERADOR';
      const finalContext = isOperador ? 'NEGOCIO' : mov.contexto;
      const key = formData.clientMessageId ? `${formData.clientMessageId}-${index}` : undefined;
      // Revisada contra el catálogo: lo que no existe ahí no se guarda.
      const propuesta = normalizarPropuesta({ contexto: finalContext, sucursal: mov.sucursal, fechaGasto: mov.fechaGasto, articulos: mov.articulos }, catalogo, hoy);
      const avisoTipos = await crearTiposNuevos(propuesta.tipos, tiposCreados, session.usuario.id);
      if (avisoTipos) avisos.push({ tipo: 'COSTOS', motivo: avisoTipos });

      let movimiento;
      try {
        movimiento = await prisma.movimiento.create({
          data: {
            idempotencyKey: key,
            contribuyenteId: 'tenant-123',
            usuarioId: session.usuario.id,
            tipo: mov.tipo.toUpperCase(),
            importe: mov.importe,
            subtotal: mov.subtotal || null,
            iva: mov.iva || null,
            tasaIva: mov.tasaIva || null,
            contexto: finalContext,
            categoria: mov.categoria,
            fechaOcurrencia: new Date(),
            descripcionOriginal,
            estado: fileUrl ? 'COMPROBADO' : 'PENDIENTE_COMPROBANTE',
            contraparteNombre: mov.contraparte || null,
            idPdvPropuesto: propuesta.idPdvPropuesto,
            fechaGasto: propuesta.fechaGasto,
            comprobantes: fileUrl ? {
              create: {
                tipo: 'TICKET_IMAGEN',
                url: fileUrl,
                datosExtraidos: JSON.stringify(mov),
                confianzaIA: 0.95
              }
            } : undefined,
            conceptos: {
              create: mov.articulos.map((art: any, i: number) => ({
                cantidad: art.cantidad,
                descripcion: art.descripcion,
                precioUnitario: art.precioUnitario,
                importeTotal: art.importeTotal,
                // Un PERSONAL nunca lleva insumos, diga lo que diga la IA; en un
                // INVENTARIO todos lo son (la categoría significa eso). El puente
                // solo mira esta marca, artículo por artículo.
                esInsumo: finalContext === 'NEGOCIO' && (mov.categoria === 'INVENTARIO' || art.esInsumo === true),
                cuentaCostoPropuesta: propuesta.cuentas[i],
                tipoGastoId: propuesta.tipos[i]?.id ?? null,
              }))
            }
          },
          include: { conceptos: true }
        });
      } catch (error: any) {
        if (error.code === 'P2002' && key) {
          console.log(`Idempotency key hit for ${key}. Skipping duplicate.`);
          const existing = await prisma.movimiento.findUnique({
             where: { idempotencyKey: key },
             include: { conceptos: true }
          });
          if (existing) {
             savedMovimientos.push(existing);
             propuestas.push('');
             index++;
             continue; // Saltamos a la siguiente iteracion para no inyectar a Firebase dos veces
          }
        }
        throw error;
      }

      // ==========================================
      // EL PUENTE FIREBASE (Inyección Directa)
      // ==========================================
      // Por ARTÍCULO, no por categoría (2026-09-16): cruza todo movimiento del
      // negocio que tenga algún insumo, y solo viajan esos artículos. Ver
      // src/lib/insumos.ts. La categoría INVENTARIO sigue valiendo "todo".
      const paraAlmacen = {
        ...movimiento,
        importe: movimiento.importe as any,
        conceptos: movimiento.conceptos.map((c) => ({
          cantidad: Number(c.cantidad),
          descripcion: c.descripcion,
          precioUnitario: c.precioUnitario === null ? null : Number(c.precioUnitario),
          importeTotal: Number(c.importeTotal),
          esInsumo: c.esInsumo
        }))
      };
      if (debeInyectar(paraAlmacen)) {
        if (dbFirestore) {
          try {
            const payload = payloadEntradaAlmacen(paraAlmacen, articulosParaAlmacen(paraAlmacen));
            const ref = await dbFirestore.collection('entradas_almacen').add(payload);
            // Se guarda el id del documento para no inyectar dos veces y para
            // poder retirarlo si el movimiento se borra.
            await prisma.movimiento.update({ where: { id: movimiento.id }, data: { entradaAlmacenId: ref.id } });
            console.log(`✅ Entrada de almacén inyectada en Firestore (${ref.id}, ${payload.articulos.length} artículos)`);
          } catch (firebaseError: any) {
            console.error("❌ Error al inyectar JSON a Firebase:", firebaseError);
            avisos.push({
              tipo: 'INVENTARIO',
              motivo: `El inventario no se actualizó: ${firebaseError?.message ?? String(firebaseError)}`
            });
          }
        } else {
          console.error("❌ Firestore no está configurado: no se inyectó la entrada de almacén");
          avisos.push({
            tipo: 'INVENTARIO',
            motivo: 'El inventario no se actualizó: Firestore no está configurado en este despliegue'
          });
        }
      }

      // El espejo va después del puente de insumos: así ya lleva el
      // entradaAlmacenId, que la plataforma usa para no contar dos veces.
      const avisoEspejo = await sincronizarEspejo(movimiento.id);
      if (avisoEspejo) avisos.push({ tipo: 'COSTOS', motivo: avisoEspejo });

      savedMovimientos.push(movimiento);
      propuestas.push(textoDePropuesta(propuesta, catalogo));
      index++;
    }
    
    return { success: true, data: savedMovimientos, ia_extraction: object, avisos, propuestas }
  } catch (error: any) {
    console.error('Error creando movimiento con IA:', error)
    return { success: false, error: 'No pude procesar la solicitud. ' + error.message }
  }
}

export async function deleteMovimiento(id: string) {
  try {
    const session = await getSession();
    if (!session) {
      throw new Error('No autorizado');
    }

    const movimiento = await prisma.movimiento.findUnique({ where: { id } });
    if (!movimiento) throw new Error('Movimiento no encontrado');

    if (session.usuario.rol !== 'ADMIN') {
      if (movimiento.usuarioId !== session.usuario.id) {
        throw new Error('No estás autorizado para borrar registros de otros usuarios.');
      }
      
      // Límite de 24 horas para operadores
      const horasTranscurridas = (Date.now() - movimiento.createdAt.getTime()) / (1000 * 60 * 60);
      if (horasTranscurridas > 24) {
        throw new Error('Solo puedes borrar registros que hayas creado en las últimas 24 horas.');
      }
    }
    
    // Al borrar el movimiento en cascada se deberían borrar conceptos y comprobantes 
    // (si la DB lo permite) o los borramos manualmente por si acaso.
    await prisma.concepto.deleteMany({ where: { movimientoId: id } });
    await prisma.comprobante.deleteMany({ where: { movimientoId: id } });
    await prisma.movimiento.delete({ where: { id } });

    // Si el movimiento había cruzado el puente, su entrada de almacén se
    // retira también (2026-09-16): antes quedaba huérfana en la plataforma.
    // Si Firestore falla, el borrado contable ya está hecho y se avisa.
    let avisoAlmacen: string | null = null;
    if (movimiento.entradaAlmacenId) {
      if (dbFirestore) {
        try {
          await dbFirestore.collection('entradas_almacen').doc(movimiento.entradaAlmacenId).delete();
        } catch (firebaseError: any) {
          avisoAlmacen = `El movimiento se borró, pero su entrada de almacén no: ${firebaseError?.message ?? String(firebaseError)}`;
          console.error('❌ No se pudo retirar la entrada de almacén:', firebaseError);
        }
      } else {
        avisoAlmacen = 'El movimiento se borró, pero su entrada de almacén sigue en la plataforma: Firestore no está configurado en este despliegue.';
      }
    }

    // Y su copia en el espejo (2026-10-11), con el mismo criterio: se avisa, no se lanza.
    let avisoEspejo: string | null = null;
    if (debeEspejar(movimiento)) {
      if (dbFirestore) {
        try {
          await dbFirestore.collection(COLECCION_ESPEJO).doc(movimiento.id).delete();
        } catch (firebaseError: any) {
          avisoEspejo = `El movimiento se borró, pero sigue en Costos de la plataforma: ${firebaseError?.message ?? String(firebaseError)}`;
          console.error('❌ No se pudo retirar el movimiento del espejo:', firebaseError);
        }
      } else {
        avisoEspejo = 'El movimiento se borró, pero sigue en Costos de la plataforma: Firestore no está configurado en este despliegue.';
      }
    }

    const aviso = [avisoAlmacen, avisoEspejo].filter(Boolean).join('\n');
    if (aviso) return { success: true, aviso };

    return { success: true };
  } catch (error: any) {
    console.error('Error al borrar movimiento:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Cambia la marca de insumo de un artículo desde el historial (2026-09-16)
 * y vuelve a sincronizar la entrada de almacén del movimiento en la
 * plataforma: crear si gana su primer insumo, actualizar si ya tenía, retirar
 * si se queda sin ninguno. Mismas reglas de permiso que borrar: el dueño en
 * sus 24 horas, o un ADMIN.
 */
export async function setConceptoInsumo(conceptoId: string, esInsumo: boolean) {
  try {
    const session = await getSession();
    if (!session) throw new Error('No autorizado');

    const concepto = await prisma.concepto.findUnique({ where: { id: conceptoId }, include: { movimiento: true } });
    if (!concepto) throw new Error('Artículo no encontrado');
    const mov = concepto.movimiento;
    if (session.usuario.rol !== 'ADMIN') {
      if (mov.usuarioId !== session.usuario.id) throw new Error('No estás autorizado para cambiar registros de otros usuarios.');
      const horas = (Date.now() - mov.createdAt.getTime()) / (1000 * 60 * 60);
      if (horas > 24) throw new Error('Solo puedes cambiar registros que hayas creado en las últimas 24 horas.');
    }
    if (mov.contexto !== 'NEGOCIO' && esInsumo) {
      throw new Error('Un movimiento personal no lleva insumos del negocio.');
    }

    await prisma.concepto.update({ where: { id: conceptoId }, data: { esInsumo } });
    const avisoAlmacen = await sincronizarEntradaAlmacen(mov.id);
    // Después del puente: el puente puede crear o retirar la entrada de almacén.
    const avisoEspejo = await sincronizarEspejo(mov.id);
    const aviso = [avisoAlmacen, avisoEspejo].filter(Boolean).join('\n') || null;
    return { success: true, aviso };
  } catch (error: any) {
    console.error('Error al cambiar la marca de insumo:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Deja la entrada de almacén del movimiento como debe estar según sus
 * artículos de hoy. Devuelve un aviso en texto si la plataforma no se pudo
 * tocar; nunca lanza, porque el cambio contable ya está hecho.
 */
async function sincronizarEntradaAlmacen(movimientoId: string): Promise<string | null> {
  const movimiento = await prisma.movimiento.findUnique({ where: { id: movimientoId }, include: { conceptos: true } });
  if (!movimiento) return null;
  const paraAlmacen = {
    ...movimiento,
    importe: movimiento.importe as any,
    conceptos: movimiento.conceptos.map((c) => ({
      cantidad: Number(c.cantidad),
      descripcion: c.descripcion,
      precioUnitario: c.precioUnitario === null ? null : Number(c.precioUnitario),
      importeTotal: Number(c.importeTotal),
      esInsumo: c.esInsumo
    }))
  };
  const accion = accionDePuente(paraAlmacen);
  if (accion === 'nada') return null;
  if (!dbFirestore) return 'La marca se guardó, pero la plataforma no se actualizó: Firestore no está configurado en este despliegue.';
  try {
    const coleccion = dbFirestore.collection('entradas_almacen');
    if (accion === 'retirar') {
      await coleccion.doc(movimiento.entradaAlmacenId!).delete();
      await prisma.movimiento.update({ where: { id: movimiento.id }, data: { entradaAlmacenId: null } });
      return null;
    }
    const payload = payloadEntradaAlmacen(paraAlmacen, articulosParaAlmacen(paraAlmacen));
    if (accion === 'actualizar') {
      await coleccion.doc(movimiento.entradaAlmacenId!).set(payload);
      return null;
    }
    const ref = await coleccion.add(payload);
    await prisma.movimiento.update({ where: { id: movimiento.id }, data: { entradaAlmacenId: ref.id } });
    return null;
  } catch (firebaseError: any) {
    console.error('❌ No se pudo sincronizar la entrada de almacén:', firebaseError);
    return `La marca se guardó, pero la plataforma no se actualizó: ${firebaseError?.message ?? String(firebaseError)}`;
  }
}

/**
 * Deja la copia del movimiento en `movimientos_finanzas` (el espejo para la
 * pestaña Costos de la plataforma, 2026-10-11) igual que el movimiento de hoy,
 * con todos sus artículos. Se lee otra vez de la base para llevar el
 * entradaAlmacenId que el puente acaba de poner o quitar. Devuelve un aviso en
 * texto si la plataforma no se pudo tocar; nunca lanza, porque el registro
 * contable ya está hecho. Lo que no llegue lo encuentra el cotejo de
 * scripts/espejar-movimientos.js.
 */
async function sincronizarEspejo(movimientoId: string): Promise<string | null> {
  try {
    const movimiento = await prisma.movimiento.findUnique({ where: { id: movimientoId }, include: { conceptos: true } });
    if (!movimiento || !debeEspejar(movimiento)) return null;
    if (!dbFirestore) return 'El movimiento no llegó a Costos de la plataforma: Firestore no está configurado en este despliegue.';
    await dbFirestore.collection(COLECCION_ESPEJO).doc(movimiento.id).set(payloadMovimientoFinanzas(movimiento, new Date()));
    return null;
  } catch (error: any) {
    console.error('❌ No se pudo escribir el movimiento en el espejo:', error);
    return `El movimiento no llegó a Costos de la plataforma: ${error?.message ?? String(error)}`;
  }
}

// El catálogo de la plataforma para la propuesta (2026-10-12): las cuentas de
// costo y las sucursales, de Firestore. Unas 45 lecturas; se guardan diez
// minutos en la memoria del servidor para no repetirlas en cada captura. Si
// Firestore falla, sale vacío y la captura sigue sin propuesta.
const MINUTOS_CATALOGO = 10;
let catalogoEnMemoria: { leido: number, catalogo: ReturnType<typeof catalogoDePropuesta> } | null = null;

async function cargarCatalogo() {
  if (catalogoEnMemoria && Date.now() - catalogoEnMemoria.leido < MINUTOS_CATALOGO * 60 * 1000) return catalogoEnMemoria.catalogo;
  if (!dbFirestore) return catalogoDePropuesta([], []);
  try {
    const db = dbFirestore;
    const [cuentas, pdvs, ...tipos] = await Promise.all(['cuentas_costo', 'puntos_venta', ...COLECCIONES_TIPOS].map((c) => db.collection(c).get()));
    const docs = (snap: FirebaseFirestore.QuerySnapshot) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const catalogo = catalogoDePropuesta(docs(cuentas), docs(pdvs), tipos.flatMap(docs));
    catalogoEnMemoria = { leido: Date.now(), catalogo };
    return catalogo;
  } catch (error) {
    console.error('❌ No se pudo leer el catálogo de la plataforma; la captura sigue sin propuesta:', error);
    return catalogoDePropuesta([], []);
  }
}

/**
 * Crea en la plataforma los tipos nuevos que pidió la IA (2026-10-12,
 * incremento 9): sin cuenta, con la que sugirió; Dirección se la da una vez.
 * `create` no pisa: si otra captura lo creó un instante antes, ese se queda.
 * Devuelve un aviso si alguno no se pudo guardar; nunca lanza, porque el
 * artículo se guarda con su tipo de todos modos y la plataforma lo resuelve
 * cuando el tipo exista.
 */
async function crearTiposNuevos(tipos: Array<{ id: string, nuevo?: { nombre: string, cuentaSugerida: string | null } } | null>, creados: Set<string>, usuarioId: string): Promise<string | null> {
  const nuevos = tipos.filter((t): t is { id: string, nuevo: { nombre: string, cuentaSugerida: string | null } } => Boolean(t?.nuevo) && !creados.has(t!.id));
  if (nuevos.length === 0) return null;
  if (!dbFirestore) return 'Los tipos de gasto nuevos no llegaron a la plataforma: Firestore no está configurado en este despliegue.';
  const fallidos: string[] = [];
  for (const t of nuevos) {
    if (creados.has(t.id)) continue;
    try {
      await dbFirestore.collection(COLECCION_TIPOS_COPILOTO).doc(t.id).create(datosDeTipoNuevo(t.nuevo, { usuarioId }));
    } catch (error: any) {
      // 6 = ALREADY_EXISTS: ya está, que es lo que se quería.
      if (error?.code !== 6) {
        console.error('❌ No se pudo crear el tipo de gasto nuevo:', error);
        fallidos.push(t.nuevo.nombre);
        continue;
      }
    }
    creados.add(t.id);
    // La próxima captura ya lo ve en la lista.
    catalogoEnMemoria = null;
  }
  return fallidos.length ? `Los tipos de gasto nuevos ${fallidos.map((n) => `«${n}»`).join(', ')} no llegaron a la plataforma; el movimiento sí quedó registrado.` : null;
}
