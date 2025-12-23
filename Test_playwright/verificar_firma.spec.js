// @ts-check
import { test } from '@playwright/test';
import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

/** 
 * OPTIMIZACIÓN MÁXIMA: 
 * 1. Paralelización: Cada RUT es un test independiente. Playwright los corre en paralelo según los workers disponibles.
 * 2. Sin esperas fijas: Se usan promesas que se resuelven apenas el elemento está listo.
 * 3. OCR Optimizado: Se usa una lógica que minimiza la inicialización.
 */

// Leer RUTs desde ruts.json (ruta relativa al root del proyecto)
const ruts = JSON.parse(fs.readFileSync('Test_playwright/ruts.json', 'utf-8'));

test.describe.configure({ mode: 'parallel' });

for (const rut of ruts) {
    test(`Validar Firma RUT: ${rut}`, async ({ page }) => {
        let alertMessage = '';

        // Manejador de alertas asíncrono
        page.on('dialog', async (dialog) => {
            alertMessage = dialog.message();
            await dialog.accept();
        });

        await page.goto('http://172.30.30.2/ineg/nuevo/', { waitUntil: 'domcontentloaded' });
        await page.locator('#rut').fill(rut);

        // Ejecutar clic y esperar ya sea una alerta o el cambio de página
        await page.getByRole('button', { name: 'Ingresar' }).click();

        // Espera inteligente: Resolvemos apenas aparezca el link O pase 1.5s (para la alerta)
        try {
            await page.getByRole('link', { name: 'Compromiso de Confidencialidad' }).waitFor({ state: 'visible', timeout: 2000 });
        } catch (e) {
            // Si el timeout salta, verificamos si fue por una alerta
            if (alertMessage) {
                console.log(`RUT: ${rut} | Resultado: NO EXISTE (${alertMessage})`);
                return;
            }
            throw new Error(`Timeout: No se pudo ingresar ni se detectó alerta para el RUT ${rut}`);
        }

        const idRUT = rut.replace(/\D/g, ''); // Solo números para el ID
        const imagePath = `imagen_${idRUT}.png`;
        const imageProcPath = `imagen_proc_${idRUT}.png`;

        try {
            const compromisoLink = page.getByRole('link', { name: 'Compromiso de Confidencialidad' });
            await compromisoLink.dblclick({ timeout: 2000 });

            const imageLocator = page.getByRole('rowgroup').getByRole('img');

            // Esperar que la imagen esté visible
            await imageLocator.waitFor({ state: 'visible', timeout: 3000 });

            // Capturar directamente (Playwright espera a que se rinderice lo suficiente)
            await imageLocator.screenshot({ path: imagePath });

            // Procesamiento de imagen ultra-rápido
            await sharp(imagePath).greyscale().toFile(imageProcPath);

            // OCR
            const { data: { text } } = await Tesseract.recognize(imageProcPath, 'spa+eng');
            const detectedText = text.trim();

            let resultado = '';
            if (detectedText.includes('FIRMA AUTORIZADA')) {
                resultado = 'Documento FIRMADO y autorizado';
            } else {
                resultado = 'Documento NO firmado';
            }

            console.log(`RUT: ${rut} | Resultado: ${resultado}`);

        } catch (error) {
            console.error(`Error en RUT ${rut}: ${error.message}`);
        } finally {
            // Cleanup veloz
            if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
            if (fs.existsSync(imageProcPath)) fs.unlinkSync(imageProcPath);
        }
    });
}