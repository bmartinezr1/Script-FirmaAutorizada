// @ts-check
import { test, expect } from '@playwright/test';
import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs';

// Lista de RUTs a analizar
const ruts = [
    '18.684.711-3', // RUT válido
    '18.684.721-3', // RUT inválido/no registrado
    // Agrega más RUTs aquí para procesar en lote de forma secuencial
];

const logFile = 'auditoria_firmas.log';

/**
 * Función para registrar eventos generales en el archivo de log
 * @param {string} mensaje 
 */
function registrarEvento(mensaje) {
    const fecha = new Date().toLocaleString();
    fs.appendFileSync(logFile, `[${fecha}] ${mensaje}\n`);
}

/**
 * Función para registrar eventos de RUT en el archivo de log
 * @param {string} rut 
 * @param {string} mensaje 
 * @param {number} tiempoMs 
 */
function registrarLog(rut, mensaje, tiempoMs) {
    const tiempoSeg = (tiempoMs / 1000).toFixed(2);
    registrarEvento(`RUT: ${rut} | Resultado: ${mensaje} | Tiempo: ${tiempoSeg}s`);
}

test('Procesamiento secuencial de firmas por RUT con Logging', async ({ page }) => {
    // Inicializar archivo de log con cabecera si es nuevo
    if (!fs.existsSync(logFile)) {
        fs.writeFileSync(logFile, '--- Inicio de Auditoría de Firmas ---\n');
    }

    for (const rut of ruts) {
        const startTime = Date.now();
        registrarEvento(`--- Iniciando análisis para RUT: ${rut} ---`);

        await page.goto('http://172.30.30.2/ineg/nuevo/');
        await page.locator('#rut').click();
        await page.locator('#rut').fill(rut);

        let resultado = '';

        try {
            await page.getByRole('button', { name: 'Ingresar' }).click();

            // Timeout de 2 segundos para detectar fallos rápidamente
            await page.getByRole('link', { name: 'Compromiso de Confidencialidad' }).dblclick({ timeout: 2000 });
            await page.waitForTimeout(500);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const errorMsg = `RUT no registrado o error en la página: ${message}`;
            await page.keyboard.press('Escape').catch(() => { });

            registrarLog(rut, errorMsg, Date.now() - startTime);
            continue;
        }

        const idRUT = rut.replace(/\./g, '').replace(/-/g, '');
        const imagePath = `imagen_${idRUT}.png`;
        const imageProcPath = `imagen_proc_${idRUT}.png`;

        try {
            const image = await page.getByRole('rowgroup').getByRole('img');
            await image.screenshot({ path: imagePath });

            await sharp(imagePath)
                .greyscale()
                .toFile(imageProcPath);

            const result = await Tesseract.recognize(imageProcPath, 'spa+eng');
            const detectedText = result.data.text.trim();

            if (detectedText.includes('FIRMA AUTORIZADA') && detectedText.includes('SERVICIO DE SALUD THNO')) {
                resultado = 'Documento FIRMADO y autorizado';
            } else {
                resultado = 'Documento NO firmado';
            }

            registrarLog(rut, resultado, Date.now() - startTime);

            if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
            if (fs.existsSync(imageProcPath)) fs.unlinkSync(imageProcPath);

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const errorFatal = `Falló procesamiento OCR: ${message}`;
            registrarLog(rut, errorFatal, Date.now() - startTime);
        }
    }
});