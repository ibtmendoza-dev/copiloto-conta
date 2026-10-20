// La extracción con IA de un mensaje o comprobante (sacada de actions.ts el
// 2026-10-19, sin cambiar la instrucción).
//
// Vive aquí y no en la acción para que la misma instrucción y el mismo esquema
// se puedan probar con capturas reales sin guardar nada: ver
// extraccion.ia.test.ts, que solo corre si se pide.

import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { REGLAS_INSUMO } from './insumos';
import { REGLAS_VERDURAS } from './verduras';
import { NINGUNA, NUEVO, hayCatalogo, hayTipos, instruccionDePropuesta } from './propuesta.mjs';

export const MODELO_EXTRACCION = 'gemini-3.6-flash'; // Versión 2026

type Catalogo = Parameters<typeof hayCatalogo>[0];

export async function extraerMovimientos({ texto, base64, mediaType = 'image/jpeg', catalogo, hoy }: {
  texto: string;
  base64?: string | null;
  mediaType?: string;
  catalogo: Catalogo;
  hoy: string;
}) {
  const messagesContent: any[] = [
    { type: 'text', text: texto }
  ];

  if (base64) {
    messagesContent.push({ type: 'file', mediaType, data: base64 });
  }

  // La propuesta para Costos (2026-10-12, src/lib/propuesta.mjs): el catálogo
  // de cuentas y sucursales de la plataforma va en la instrucción. Si no se
  // puede leer, la captura sigue igual que antes, sin propuesta.
  const conPropuesta = hayCatalogo(catalogo);
  const idsCuenta: [string, ...string[]] = [NINGUNA, ...catalogo.cuentas.map((c: { id: string }) => c.id)];
  const idsPdv: [string, ...string[]] = [NINGUNA, ...catalogo.pdvs.map((p: { id: string }) => p.id)];
  // Los tipos de gasto (2026-10-12, incremento 9): la lista de la caja y la
  // del Copiloto, más "nuevo" para pedir uno.
  const conTipos = hayTipos(catalogo);
  const idsTipo: [string, ...string[]] = [NINGUNA, NUEVO, ...catalogo.tipos.map((t: { id: string }) => t.id)];

  const { object } = await generateObject({
    model: google(MODELO_EXTRACCION),
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
      ${REGLAS_VERDURAS}
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
          esVerdura: z.boolean().optional().describe('true solo si es una verdura fresca de verdulería (zanahoria, pepino, calabaza, morrón, cebolla, chiles, limón...); false en todo lo demás, también en las frutas.'),
          porPeso: z.boolean().optional().describe('true si la cantidad está en kilos o litros; false si son piezas, paquetes, bultos o cajas.'),
          cargoDeEntrega: z.boolean().optional().describe('true SOLO para la comisión de entrega del proveedor de verduras; false en todo lo demás, también en otros envíos o fletes.'),
          cuentaCosto: (conPropuesta ? z.enum(idsCuenta) : z.string()).optional().describe(`El id de la cuenta de costo del artículo, de la lista; "${NINGUNA}" si ninguna le queda clara.`),
          tipoGasto: (conTipos ? z.enum(idsTipo) : z.string()).optional().describe(`El id del tipo de gasto del artículo, de la lista; "${NUEVO}" si ninguno le queda; "${NINGUNA}" en lo personal.`),
          tipoNuevo: z.string().optional().describe(`Solo con "${NUEVO}": el nombre corto y general del tipo nuevo, de una a tres palabras.`)
        })).describe('OBLIGATORIO: Arreglo de artículos adquiridos. NUNCA lo omitas. Si no hay productos, devuelve un arreglo vacío [].'),
      })).describe('Lista de movimientos económicos identificados en el mensaje.')
    }),
  });

  return object;
}
