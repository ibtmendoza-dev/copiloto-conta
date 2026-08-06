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

    const messagesContent: any[] = [
      { type: 'text', text: formData.inputOriginal }
    ];

    if (base64Content) {
      messagesContent.push({ type: 'file', mediaType, data: base64Content });
    }

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
      
      TABLA DE EXCEPCIONES FISCALES (MÉXICO) PARA CALCULO CIEGO:
      Antes de calcular el IVA a ciegas, clasifica los "articulos" que identificaste contra esta tabla:
      1. Gasolina/Combustible: Contiene IEPS. Aproxima así: Subtotal = Total * 0.85, IVA = Total * 0.13. (Tasa: "16% Especial")
      2. Alimentos frescos (frutas, verduras, carnes), Medicinas y Libros: Tasa 0% (IVA = 0, Subtotal = Total. Tasa: "0%")
      3. Honorarios médicos: Exentos (IVA = 0, Subtotal = Total. Tasa: "EXENTO")
      4. Otros productos generales: Tasa estándar 16% (Total / 1.16 = Subtotal, Total - Subtotal = IVA. Tasa: "16%")
      
      REGLAS DE CONTEXTO (NEGOCIO VS PERSONAL):
      - Todo movimiento pertenece a un 'contexto'. Puede ser 'NEGOCIO' o 'PERSONAL'.
      - Si el usuario dice que es para la casa, gasto familiar, personal, o algo que claramente no es de la empresa, márcalo como 'PERSONAL'.
      - Si no dice nada, o si es materia prima, mantenimiento de la empresa, inventario, etc., márcalo por defecto como 'NEGOCIO'.`,
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
          articulos: z.array(z.object({
            cantidad: z.number().describe('La cantidad adquirida del producto.'),
            descripcion: z.string().describe('El nombre o descripción del producto o servicio.'),
            precioUnitario: z.number().describe('El precio por unidad.'),
            importeTotal: z.number().describe('El importe total por esta línea (cantidad * precio unitario).')
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

    const savedMovimientos = [];

    let index = 0;
    for (const mov of object.movimientos) {
      const isOperador = session.usuario.rol === 'OPERADOR';
      const finalContext = isOperador ? 'NEGOCIO' : mov.contexto;
      const key = formData.clientMessageId ? `${formData.clientMessageId}-${index}` : undefined;

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
            comprobantes: fileUrl ? {
              create: {
                tipo: 'TICKET_IMAGEN',
                url: fileUrl,
                datosExtraidos: JSON.stringify(mov),
                confianzaIA: 0.95
              }
            } : undefined,
            conceptos: {
              create: mov.articulos.map((art: any) => ({
                cantidad: art.cantidad,
                descripcion: art.descripcion,
                precioUnitario: art.precioUnitario,
                importeTotal: art.importeTotal,
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
             index++;
             continue; // Saltamos a la siguiente iteracion para no inyectar a Firebase dos veces
          }
        }
        throw error;
      }

      // ==========================================
      // EL PUENTE FIREBASE (Inyección Directa)
      // ==========================================
      if (movimiento.contexto === 'NEGOCIO' && movimiento.categoria === 'INVENTARIO') {
        if (dbFirestore) {
          try {
            const aNumero = (valor: any) =>
              valor === null || valor === undefined ? null : Number(valor);

            const payload = {
              fechaOcurrencia: movimiento.fechaOcurrencia,
              origen: "Copiloto Conta (Finanzas)",
              totalGastado: aNumero(movimiento.importe),
              usuarioId: movimiento.usuarioId,
              articulos: mov.articulos.map((art: any) => ({
                cantidad: aNumero(art.cantidad),
                descripcion: art.descripcion ?? null,
                precioUnitario: aNumero(art.precioUnitario),
                importeTotal: aNumero(art.importeTotal),
              }))
            };
            
            await dbFirestore.collection('entradas_almacen').add(payload);
            console.log("✅ JSON inyectado exitosamente a Firebase Firestore");
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

      savedMovimientos.push(movimiento);
      index++;
    }
    
    return { success: true, data: savedMovimientos, ia_extraction: object, avisos }
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

    // TODO: Eliminar de Firebase si es inventario, pero por ahora en MVP basta borrarlo localmente.
    
    return { success: true };
  } catch (error: any) {
    console.error('Error al borrar movimiento:', error);
    return { success: false, error: error.message };
  }
}
