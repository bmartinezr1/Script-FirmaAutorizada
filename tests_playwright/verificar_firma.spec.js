// @ts-check
import { test } from '@playwright/test';
import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs';

const estados = {
    autorizado: 'autorizado',
    noFirmado: 'no_firmado',
    noRegistro: 'no_registro',
    noExiste: 'no_existe',
    falloOcr: 'fallo_ocr',
};

let ruts = [];
const rutInput = process.env.RUTS;

if (rutInput) {
    ruts = rutInput.split(',').map((rut) => rut.trim()).filter(Boolean);
} else {
    // Cargar RUTs desde archivo JSON si no se proporciona variable de entorno
    try {
        const rutFile = await fs.promises.readFile('ruts_masivos.json', 'utf-8');
        const rutData = JSON.parse(rutFile);
        ruts = rutData.ruts || [];
    } catch (error) {
        ruts = ['18.684.711-3'];
    }
}

const fsp = fs.promises;

function normalizarRut(rut) {
    return rut.replace(/\./g, '').replace(/-/g, '');
}

async function limpiarArchivos(...rutas) {
    for (const ruta of rutas) {
        if (fs.existsSync(ruta)) {
            await fsp.unlink(ruta).catch(() => { });
        }
    }
}

/**
 * Verifica la autorización de firma para un RUT y devuelve un estado estructurado.
 * @param {string} rut
 * @param {import('@playwright/test').Page} page
 */
async function verificarFirma(rut, page) {
    // Manejador de diálogos (alertas) para detectar RUTs no existentes
    let alertMessage = '';
    const dialogHandler = async (dialog) => {
        alertMessage = dialog.message();
        await dialog.accept();
    };
    page.on('dialog', dialogHandler);

    try {
        await page.goto('http://172.30.30.2/ineg/nuevo/');
        await page.locator('#rut').click();
        await page.locator('#rut').fill(rut);
        await page.getByRole('button', { name: 'Ingresar' }).click();

        // Esperar a ver si aparece una alerta
        await page.waitForTimeout(1000);

        if (alertMessage) {
            const mensaje = `NO EXISTE (${alertMessage})`;
            console.log(`RUT: ${rut} | Resultado: ${mensaje}`);
            page.off('dialog', dialogHandler);
            return { estado: estados.noExiste, detalle: `RUT no existe en el sistema: ${alertMessage}` };
        }

        await page.getByRole('link', { name: 'Compromiso de Confidencialidad' }).dblclick({ timeout: 2000 });
        await page.waitForTimeout(500);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('timeout')) {
            console.log(`RUT: ${rut} | Resultado: ERROR (Tiempo excedido al buscar el compromiso)`);
        } else {
            console.error(`Error inesperado para RUT ${rut}: ${message}`);
        }
        await page.keyboard.press('Escape').catch(() => { });
        page.off('dialog', dialogHandler);
        const errorMsg = message.includes('timeout') 
            ? 'Tiempo excedido al buscar el compromiso de confidencialidad'
            : `RUT no registrado o error en la página: ${message}`;
        return { estado: estados.noRegistro, detalle: errorMsg };
    }

    const idRUT = normalizarRut(rut);
    const imagePath = `imagen_${idRUT}.png`;
    const imageProcPath = `imagen_proc_${idRUT}.png`;

    try {
        const image = await page.getByRole('rowgroup').getByRole('img');
        await image.waitFor({ state: 'visible', timeout: 5000 });

        // Asegurarse de que la imagen terminó de cargar completamente
        await image.evaluate(async (img) => {
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

        await image.screenshot({ path: imagePath });

        await sharp(imagePath).greyscale().toFile(imageProcPath);

        const result = await Tesseract.recognize(imageProcPath, 'spa+eng');
        const detectedText = result.data.text.trim();
        const tieneFirma = detectedText.includes('FIRMA AUTORIZADA') && detectedText.includes('SERVICIO DE SALUD THNO');

        const estado = tieneFirma ? estados.autorizado : estados.noFirmado;
        const mensaje = tieneFirma ? 'Documento FIRMADO y autorizado' : 'Documento NO firmado (Imagen encontrada pero no detectó firma)';
        console.log(`RUT: ${rut} | Resultado: ${mensaje}`);

        return { estado, detalle: mensaje };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const errorFatal = `Falló procesamiento OCR: ${message}`;
        console.error(`Error inesperado para RUT ${rut}: ${message}`);
        return { estado: estados.falloOcr, detalle: errorFatal };
    } finally {
        await limpiarArchivos(imagePath, imageProcPath);
        page.off('dialog', dialogHandler);
    }
}

//BRANDON MARCONANANNSNANDA
test('Procesamiento secuencial de firmas por RUT con Logging', async ({ page }) => {
    const timeoutPorRut = 30000; // 30 segundos por RUT
    const timeoutTotal = ruts.length * timeoutPorRut;
    test.setTimeout(timeoutTotal);

    for (const rut of ruts) {
        const resultado = await verificarFirma(rut, page);
    }
});