#!/usr/bin/env node
// @ts-check

/**
 * Ejecutor CLI para validación de firmas
 * Puede ser llamado desde otros lenguajes (PHP, Python, etc.)
 * 
 * Uso:
 *   node ejecutor.js "18.684.711-3"
 *   node ejecutor.js "18.684.711-3,19.234.567-8"
 */

import { chromium } from 'playwright';
import { verificarFirma, cargarRuts } from './firma-utils.js';
import fs from 'fs';

async function main() {
    // Toma el primer argumento del comando (lo que viene después del nombre del script)
    const args = process.argv.slice(2);
    const rutInput = args[0] || process.env.RUTS;
    
    let ruts = [];
    
    // Si pasaron RUTs por parámetro, los separamos por coma
    if (rutInput) {
        ruts = rutInput.split(',').map((rut) => rut.trim()).filter(Boolean);
    } else {
        // Si no, intentamos cargar desde el archivo JSON
        ruts = await cargarRuts();
    }
    
    // Validación básica: si no hay RUTs, no tiene sentido continuar
    if (ruts.length === 0) {
        console.error(JSON.stringify({ 
            error: 'No se proporcionaron RUTs para validar',
            uso: 'node ejecutor.js "RUT1,RUT2,..."' 
        }));
        process.exit(1);
    }
    
    // Levantamos el navegador en modo headless (sin interfaz)
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    const resultados = [];
    
    // Procesamos cada RUT uno por uno (secuencial, no paralelo)
    for (const rut of ruts) {
        try {
            const resultado = await verificarFirma(rut, page);
            resultados.push({ rut, ...resultado });
            
            // Imprimimos cada resultado apenas lo tenemos (útil para streaming en tiempo real)
            console.log(JSON.stringify({ rut, detalle: resultado.detalle, firmado: resultado.firmado }));
            
        } catch (error) {
            // Si falla algo inesperado, igual lo registramos
            const errorResult = {
                rut,
                detalle: error.message,
                firmado: false
            };
            resultados.push(errorResult);
            console.log(JSON.stringify(errorResult));
        }
    }
    
    await browser.close();
    
    // Guardamos todos los resultados en un archivo JSON
    const nombreArchivo = `resultados_${Date.now()}.json`;
    await fs.promises.writeFile(
        nombreArchivo, 
        JSON.stringify(resultados, null, 2),
        'utf-8'
    );
    
    // Resumen final
    const resumen = {
        total: resultados.length,
        firmados: resultados.filter(r => r.firmado).length,
        noFirmados: resultados.filter(r => !r.firmado).length,
        resultados
    };
    
    // Mostramos el resumen en stderr para no mezclarlo con los JSON de salida
    console.error(`\nRESUMEN: ${resumen.firmados} firmados | ${resumen.noFirmados} no firmados`);
    console.error(`Resultados guardados en: ${nombreArchivo}`);
    
    process.exit(0);
}

// Manejador global de errores fatales
main().catch(error => {
    console.error(JSON.stringify({ 
        error: 'Error fatal',
        detalle: error.message 
    }));
    process.exit(1);
});
