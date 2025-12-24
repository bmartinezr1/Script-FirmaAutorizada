// @ts-check
import { test } from '@playwright/test';
import Tesseract from 'tesseract.js';  //OCR lee texto de imagenes
import sharp from 'sharp';  // Procesamiento de imagenes (AJustar escala de grises)
import fs from 'fs';  //Sistema de archivos

// 🕒 Variables globales para medir tiempo total incluyendo setup/teardown de Playwright
let tiempoInicioGlobal;
let tiempoFinGlobal;

// 📊 Captura tiempo al cargar el módulo (antes de cualquier hook)
const tiempoInicioModulo = Date.now();

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
 * Función simplificada para sistemas externos: retorna solo boolean
 * @param {string} rut - RUT a verificar
 * @param {import('@playwright/test').Page} page - Página de Playwright
 * @returns {Promise<boolean>} true si está firmado, false en cualquier otro caso
 */
export async function estaFirmado(rut, page) {
    const resultado = await verificarFirma(rut, page);
    return resultado.estado === estados.autorizado;
}

/**
 * Verifica la autorización de firma para un RUT y devuelve un estado estructurado.
 * @param {string} rut
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{estado: string, detalle: string, firmado: boolean}>}
 */
async function verificarFirma(rut, page) {
    // Manejador de diálogos (alertas) para detectar RUTs no existentes
    let alertMessage = '';
    const dialogHandler = async (dialog) => {
        alertMessage = dialog.message();
        await dialog.accept();
    };
    page.on('dialog', dialogHandler);

    const tiempoInicio = Date.now();

    try {
        // Navegación con timeout explícito y manejo de errores de red
        await page.goto('http://172.30.30.2/ineg/nuevo/', { 
            timeout: 8000,
            waitUntil: 'domcontentloaded' 
        }).catch((err) => {
            throw new Error(`Error de red: No se pudo conectar al servidor - ${err.message}`);
        });
        
        await page.locator('#rut').click();
        await page.locator('#rut').fill(rut);
        await page.getByRole('button', { name: 'Ingresar' }).click();
        await page.waitForTimeout(400);

        if (alertMessage) {
            const tiempoFin = Date.now();
            const tiempoTotal = ((tiempoFin - tiempoInicio) / 1000).toFixed(2);
            console.log(`RUT: ${rut} | Resultado: NO EXISTE (${alertMessage}) | Tiempo_total = ${tiempoTotal}s`);
            page.off('dialog', dialogHandler);
            return { estado: estados.noExiste, detalle: `RUT no existe en el sistema: ${alertMessage}`, firmado: false };
        }

        await page.getByRole('link', { name: 'Compromiso de Confidencialidad' }).dblclick({ timeout: 3000 });
        await page.waitForTimeout(200);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const tiempoFin = Date.now();
        const tiempoTotal = ((tiempoFin - tiempoInicio) / 1000).toFixed(2);
        const errorMsg = message.includes('timeout') 
            ? 'Tiempo excedido al buscar el compromiso de confidencialidad'
            : `RUT no registrado o error en la página: ${message}`;
        console.log(`RUT: ${rut} | Resultado: ${errorMsg} | Tiempo_total = ${tiempoTotal}s`);
        await page.keyboard.press('Escape').catch(() => { });
        page.off('dialog', dialogHandler);
        return { estado: estados.noRegistro, detalle: errorMsg, firmado: false };
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
                setTimeout(resolve, 2000);
            });
        });
        await page.waitForTimeout(300);

        await image.screenshot({ path: imagePath });
        await sharp(imagePath).greyscale().toFile(imageProcPath);
        const result = await Tesseract.recognize(imageProcPath, 'spa');

        const detectedText = result.data.text.trim();
        const tieneFirma = detectedText.includes('FIRMA AUTORIZADA') && detectedText.includes('SERVICIO DE SALUD THNO');

        const estado = tieneFirma ? estados.autorizado : estados.noFirmado;
        const mensaje = tieneFirma ? 'Documento FIRMADO y autorizado' : 'Documento NO firmado';
        const tiempoFin = Date.now();
        const tiempoTotal = ((tiempoFin - tiempoInicio) / 1000).toFixed(2);
        console.log(`RUT: ${rut} | Resultado: ${mensaje} | Tiempo_total = ${tiempoTotal}s`);
        return { estado, detalle: mensaje, firmado: tieneFirma };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const errorFatal = `Falló procesamiento OCR: ${message}`;
        const tiempoFin = Date.now();
        const tiempoTotal = ((tiempoFin - tiempoInicio) / 1000).toFixed(2);
        console.log(`RUT: ${rut} | Resultado: ${errorFatal} | Tiempo_total = ${tiempoTotal}s`);
        return { estado: estados.falloOcr, detalle: errorFatal, firmado: false };
    } finally {
        await limpiarArchivos(imagePath, imageProcPath);
        page.off('dialog', dialogHandler);
    }
}

test.beforeAll(async () => {
    tiempoInicioGlobal = Date.now();
});

test.afterAll(async () => {
    tiempoFinGlobal = Date.now();
});

test('Procesamiento secuencial de firmas por RUT con Logging', async ({ page }) => {
    const timeoutPorRut = 30000; // 30 segundos por RUT
    const timeoutTotal = ruts.length * timeoutPorRut;
    test.setTimeout(timeoutTotal);

    for (const rut of ruts) {
        await verificarFirma(rut, page);
    }
});