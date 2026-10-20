// La extracción de verdad, con Gemini, sobre capturas reales del proveedor de
// verduras (2026-10-19). NO corre con `npm test`: gasta cuota. No guarda nada.
//
//   PROBAR_IA=1 CAPTURAS_VERDURAS=<carpeta> npx vitest run src/lib/extraccion.ia.test.ts
//
// La carpeta (fuera del repositorio: son mensajes reales) trae las imágenes y
// un `esperado.json`: { "captura.png": { "importe": 1100, "comision": 300,
// "paquetes": 6, "sinComision": [] } }. La prueba pasa la captura por
// extraerMovimientos y por el reparto, igual que la acción, y compara.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { extraerMovimientos } from './extraccion';
import { repartirComisionDeVerduras, textoDeReparto } from './verduras';
import { catalogoDePropuesta, hoyEnMexico } from './propuesta.mjs';

const carpeta = process.env.CAPTURAS_VERDURAS || '';
const activa = process.env.PROBAR_IA === '1' && carpeta && existsSync(path.join(carpeta, 'esperado.json'));
const NOMBRES = ['Zanahoria', 'Pepino', 'Calabaza', 'Morrón', 'Cebolla', 'Limón'];

type Esperado = { importe: number; comision: number; paquetes: number; sinComision?: string[] };
const esperados: Record<string, Esperado> = activa ? JSON.parse(readFileSync(path.join(carpeta, 'esperado.json'), 'utf8')) : {};

describe.skipIf(!activa)('extracción de capturas del proveedor de verduras (Gemini)', () => {
  config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

  for (const [archivo, esperado] of Object.entries(esperados)) {
    it(archivo, async () => {
      const base64 = readFileSync(path.join(carpeta, archivo)).toString('base64');
      const object = await extraerMovimientos({ texto: '', base64, mediaType: 'image/png', catalogo: catalogoDePropuesta([], []), hoy: hoyEnMexico() });
      expect(object.movimientos).toHaveLength(1);
      const crudo = object.movimientos[0];
      const { movimiento, reparto } = repartirComisionDeVerduras(crudo);
      console.log(`\n${archivo}: $${crudo.importe}, ${crudo.categoria}, ${crudo.contraparte ?? ''}, fecha "${crudo.fechaGasto ?? ''}"`);
      crudo.articulos.forEach((a) => console.log(`  leído    ${a.cantidad} × ${a.descripcion} = $${a.importeTotal} ${a.porPeso ? '(por peso)' : ''}${a.cargoDeEntrega ? '(comisión)' : ''}${a.esVerdura ? '' : ' [no verdura]'}`));
      movimiento.articulos.forEach((a) => console.log(`  guardado ${a.cantidad} × ${a.descripcion} a $${a.precioUnitario} = $${a.importeTotal}`));
      console.log(`  ${textoDeReparto(reparto)}`);

      expect(crudo.importe).toBe(esperado.importe);
      expect(reparto).not.toBeNull();
      expect(reparto?.comision).toBe(esperado.comision);
      expect(reparto?.paquetes).toBe(esperado.paquetes);
      expect(reparto?.sinComision ?? []).toEqual(esperado.sinComision ?? []);
      const suma = Math.round(movimiento.articulos.reduce((s, a) => s + a.importeTotal, 0) * 100) / 100;
      expect(suma).toBe(esperado.importe);
      movimiento.articulos.forEach((a) => expect(NOMBRES).toContain(a.descripcion));
    }, 120000);
  }
});
