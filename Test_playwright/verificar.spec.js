// @ts-check
import { test, expect } from '@playwright/test';
import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs';

// Leer RUTs desde ruts.json
const ruts = JSON.parse(fs.readFileSync('Test_playwright/ruts.json', 'utf-8'));

test('Verificación de firmas por RUT - Multiescenario', async ({ page }) => {
    for (const rut of ruts) {


        // Manejador de diálogos (alertas)
        let alertMessage = '';
        const dialogHandler = async (/** @type {import('@playwright/test').Dialog} */ dialog) => {
            alertMessage = dialog.message();
            await dialog.accept();
        };
        page.on('dialog', dialogHandler);

        await page.goto('http://172.30.30.2/ineg/nuevo/');
        await page.locator('#rut').fill(rut);
        await page.getByRole('button', { name: 'Ingresar' }).click();

        // Breve espera para ver si sale una alerta
        await page.waitForTimeout(1000);

        if (alertMessage) {
            console.log(`RUT: ${rut} | Resultado: NO EXISTE (${alertMessage})`);
            page.off('dialog', dialogHandler);
            continue;
        }

        try {
            // Intentar detectar si entramos a la página de firma double-clicking el compromiso
            const compromisoLink = page.getByRole('link', { name: 'Compromiso de Confidencialidad' });
            await compromisoLink.dblclick({ timeout: 5000 });

            const imageLocator = page.getByRole('rowgroup').getByRole('img');
            await imageLocator.waitFor({ state: 'visible', timeout: 5000 });

            // Asegurarse de que la imagen terminó de cargar su contenido
            await imageLocator.evaluate(async (img) => {
                if (!(img instanceof HTMLImageElement)) return;
                const isLoaded = () => img.complete && img.naturalWidth > 0;
                if (isLoaded()) return;
                await new Promise((resolve) => {
                    img.onload = resolve;
                    img.onerror = resolve;
                    setTimeout(resolve, 3000);
                });
            });
            await page.waitForTimeout(1000);

            const idRUT = rut.replace(/\./g, '').replace(/-/g, '');
            const imagePath = `imagen_${idRUT}.png`;
            const imageProcPath = `imagen_proc_${idRUT}.png`;

            await imageLocator.screenshot({ path: imagePath });

            await sharp(imagePath)
                .greyscale()
                .toFile(imageProcPath);

            const result = await Tesseract.recognize(imageProcPath, 'spa+eng');
            const detectedText = result.data.text.trim();

            let resultado = '';
            if (detectedText.includes('FIRMA AUTORIZADA') && detectedText.includes('SERVICIO DE SALUD THNO')) {
                resultado = 'Documento FIRMADO y autorizado';
            } else {
                resultado = 'Documento NO firmado (Imagen encontrada pero no detectó firma)';
            }

            console.log(`RUT: ${rut} | Resultado: ${resultado}`);

            // Limpiar archivos temporales
            if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
            if (fs.existsSync(imageProcPath)) fs.unlinkSync(imageProcPath);

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('timeout')) {
                console.log(`RUT: ${rut} | Resultado: ERROR (Tiempo excedido al buscar el compromiso)`);
            } else {
                console.error(`Error inesperado para RUT ${rut}: ${message}`);
            }
            await page.keyboard.press('Escape').catch(() => { });
        } finally {
            page.off('dialog', dialogHandler);
        }
    }
});