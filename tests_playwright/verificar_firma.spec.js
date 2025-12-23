// @ts-check
import { test } from '@playwright/test';
import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs';

const logFile = 'auditoria_firmas.log';
const estados = {
    autorizado: 'autorizado',
    noFirmado: 'no_firmado',
    noRegistro: 'no_registro',
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
        console.warn('No se pudo cargar ruts_masivos.json, usando RUT por defecto');
        ruts = ['18.684.711-3'];
    }
}

const fsp = fs.promises;

function normalizarRut(rut) {
    return rut.replace(/\./g, '').replace(/-/g, '');
}

function ts() {
    return new Date().toISOString();
}

async function registrarEvento(mensaje) {
    await fsp.appendFile(logFile, `[${ts()}] ${mensaje}\n`);
}

async function registrarLog(rut, mensaje, tiempoMs) {
    const tiempoSeg = (tiempoMs / 1000).toFixed(2);
    await registrarEvento(`RUT: ${rut} | Resultado: ${mensaje} | Tiempo: ${tiempoSeg}s`);
}

async function prepararLog() {
    const existe = fs.existsSync(logFile);
    if (!existe) {
        await fsp.writeFile(logFile, '--- Inicio de Auditoría de Firmas ---\n');
    }
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
    const inicio = Date.now();
    await registrarEvento(`--- Iniciando análisis para RUT: ${rut} ---`);

    try {
        await page.goto('http://172.30.30.2/ineg/nuevo/');
        await page.locator('#rut').click();
        await page.locator('#rut').fill(rut);
        await page.getByRole('button', { name: 'Ingresar' }).click();

        await page.getByRole('link', { name: 'Compromiso de Confidencialidad' }).dblclick({ timeout: 2000 });
        await page.waitForTimeout(1500);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const errorMsg = `RUT no registrado o error en la página: ${message}`;
        await page.keyboard.press('Escape').catch(() => { });
        await registrarLog(rut, errorMsg, Date.now() - inicio);
        return { estado: estados.noRegistro, detalle: errorMsg };
    }

    const idRUT = normalizarRut(rut);
    const imagePath = `imagen_${idRUT}.png`;
    const imageProcPath = `imagen_proc_${idRUT}.png`;

    try {
        const image = await page.getByRole('rowgroup').getByRole('img');
        await image.screenshot({ path: imagePath });

        await sharp(imagePath).greyscale().toFile(imageProcPath);

        const result = await Tesseract.recognize(imageProcPath, 'spa+eng');
        const detectedText = result.data.text.trim();
        const tieneFirma = detectedText.includes('FIRMA AUTORIZADA') && detectedText.includes('SERVICIO DE SALUD THNO');

        const estado = tieneFirma ? estados.autorizado : estados.noFirmado;
        const mensaje = tieneFirma ? 'Documento FIRMADO y autorizado' : 'Documento NO firmado';
        await registrarLog(rut, mensaje, Date.now() - inicio);

        return { estado, detalle: mensaje };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const errorFatal = `Falló procesamiento OCR: ${message}`;
        await registrarLog(rut, errorFatal, Date.now() - inicio);
        return { estado: estados.falloOcr, detalle: errorFatal };
    } finally {
        await limpiarArchivos(imagePath, imageProcPath);
    }
}

//BRANDON MARCONANANNSNANDA
test('Procesamiento secuencial de firmas por RUT con Logging', async ({ page }) => {
    const timeoutPorRut = 30000; // 30 segundos por RUT
    const timeoutTotal = ruts.length * timeoutPorRut;
    test.setTimeout(timeoutTotal);
    console.log(`Configurado timeout de ${(timeoutTotal / 1000 / 60).toFixed(1)} minutos para ${ruts.length} RUTs`);
    
    await prepararLog();

    for (const rut of ruts) {
        const resultado = await verificarFirma(rut, page);
        console.log(`[${rut}] estado=${resultado.estado} detalle=${resultado.detalle}`);
    }
});