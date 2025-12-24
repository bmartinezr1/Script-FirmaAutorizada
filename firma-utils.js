// @ts-check
import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs';

const fsp = fs.promises;

/**
 * Estados posibles de validación de firma
 * Básicamente un enum para evitar strings mágicos por todos lados
 */
export const estados = {
    autorizado: 'autorizado',
    noFirmado: 'no_firmado',
    noRegistro: 'no_registro',
    noExiste: 'no_existe',
    falloOcr: 'fallo_ocr',
};

/**
 * Normaliza un RUT removiendo puntos y guiones
 * Ejemplo: "18.684.711-3" => "186847113"
 * @param {string} rut 
 * @returns {string}
 */
export function normalizarRut(rut) {
    return rut.replace(/\./g, '').replace(/-/g, '');
}

/**
 * Limpia archivos temporales de imágenes
 * No importa si fallan, por eso el catch vacío
 * @param {...string} rutas 
 */
export async function limpiarArchivos(...rutas) {
    for (const ruta of rutas) {
        if (fs.existsSync(ruta)) {
            await fsp.unlink(ruta).catch(() => { });
        }
    }
}

/**
 * Procesa una imagen de firma con OCR
 * Convierte a escala de grises para mejorar la detección
 * @param {string} imagePath - Ruta de la imagen original
 * @param {string} imageProcPath - Ruta de la imagen procesada
 * @returns {Promise<boolean>} true si detecta firma autorizada
 */
export async function procesarImagenFirma(imagePath, imageProcPath) {
    // Convertimos a escala de grises porque Tesseract funciona mejor así
    await sharp(imagePath).greyscale().toFile(imageProcPath);
    
    // Ejecutamos OCR con idiomas español e inglés
    const result = await Tesseract.recognize(imageProcPath, 'spa+eng');
    const detectedText = result.data.text.trim();
    
    // Buscamos el texto exacto que aparece cuando hay firma autorizada
    return detectedText.includes('FIRMA AUTORIZADA') && 
           detectedText.includes('SERVICIO DE SALUD THNO');
}

/**
 * Verifica la autorización de firma para un RUT
 * Esta es la función principal que maneja todo el flujo
 * @param {string} rut - RUT a verificar
 * @param {import('@playwright/test').Page} page - Página de Playwright
 * @returns {Promise<{estado: string, detalle: string, firmado: boolean}>}
 */
export async function verificarFirma(rut, page) {
    let alertMessage = '';
    
    // Interceptamos los alerts del navegador para capturar mensajes de error
    const dialogHandler = async (dialog) => {
        alertMessage = dialog.message();
        await dialog.accept();
    };
    page.on('dialog', dialogHandler);

    try {
        // Navegamos a la intranet (URL interna del sistema)
        await page.goto('http://172.30.30.2/ineg/nuevo/', { 
            timeout: 8000,
            waitUntil: 'domcontentloaded' // No esperamos a que cargue TODO, solo el DOM
        }).catch((err) => {
            throw new Error(`Error de red: No se pudo conectar al servidor - ${err.message}`);
        });
        
        // Llenamos el formulario con el RUT
        await page.locator('#rut').click();
        await page.locator('#rut').fill(rut);
        await page.getByRole('button', { name: 'Ingresar' }).click();
        
        // Esperamos un poco para que procese (el sistema es lento)
        await page.waitForTimeout(400);

        // Si apareció un alert, significa que el RUT no existe
        if (alertMessage) {
            page.off('dialog', dialogHandler);
            return { 
                estado: estados.noExiste, 
                detalle: `RUT no existe en el sistema: ${alertMessage}`, 
                firmado: false
            };
        }

        // Intentamos hacer doble click en el link del compromiso de confidencialidad
        await page.getByRole('link', { name: 'Compromiso de Confidencialidad' }).dblclick({ timeout: 3000 });
        await page.waitForTimeout(200);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const errorMsg = message.includes('timeout') 
            ? 'Tiempo excedido al buscar el compromiso de confidencialidad'
            : `RUT no registrado o error en la página: ${message}`;
        
        // Presionamos Escape por si quedó algún modal abierto
        await page.keyboard.press('Escape').catch(() => { });
        page.off('dialog', dialogHandler);
        
        return { 
            estado: estados.noRegistro, 
            detalle: errorMsg, 
            firmado: false
        };
    }

    // Creamos nombres únicos para las imágenes usando el RUT normalizado
    const idRUT = normalizarRut(rut);
    const imagePath = `imagen_${idRUT}.png`;
    const imageProcPath = `imagen_proc_${idRUT}.png`;

    try {
        // Buscamos la imagen del documento en la tabla
        const image = await page.getByRole('rowgroup').getByRole('img');
        await image.waitFor({ state: 'visible', timeout: 5000 });

        // Este truco es necesario porque a veces la imagen no se carga completamente
        // Ejecutamos código JS dentro del navegador para esperar a que cargue
        await image.evaluate(async (img) => {
            if (!(img instanceof HTMLImageElement)) return;
            const isLoaded = () => img.complete && img.naturalWidth > 0;
            if (isLoaded()) return;
            await new Promise((resolve) => {
                img.onload = resolve;
                img.onerror = resolve;
                setTimeout(resolve, 3000); // Timeout de seguridad aumentado
            });
        });
        
        // Esperamos más tiempo para asegurar que la imagen esté completamente cargada
        await page.waitForTimeout(800);

        // Capturamos screenshot de la imagen
        await image.screenshot({ path: imagePath });
        
        // Procesamos con OCR para detectar el texto de firma autorizada
        const tieneFirma = await procesarImagenFirma(imagePath, imageProcPath);

        const estado = tieneFirma ? estados.autorizado : estados.noFirmado;
        const mensaje = tieneFirma ? 'Documento FIRMADO y autorizado' : 'Documento NO firmado';
        
        // Limpiamos las imágenes temporales
        await limpiarArchivos(imagePath, imageProcPath);
        page.off('dialog', dialogHandler);
        
        return { estado, detalle: mensaje, firmado: tieneFirma };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const errorFatal = `Falló procesamiento OCR: ${message}`;
        
        // Limpiamos aunque haya fallado
        await limpiarArchivos(imagePath, imageProcPath);
        page.off('dialog', dialogHandler);
        
        return { 
            estado: estados.falloOcr,
            detalle: errorFatal, 
            firmado: false
        };
    }
}

/**
 * Función simplificada que retorna solo boolean
 * Útil cuando solo necesitas saber si/no sin detalles
 * @param {string} rut - RUT a verificar
 * @param {import('@playwright/test').Page} page - Página de Playwright
 * @returns {Promise<boolean>} true si está firmado, false en cualquier otro caso
 */
export async function estaFirmado(rut, page) {
    const resultado = await verificarFirma(rut, page);
    return resultado.firmado;
}

/**
 * Carga RUTs desde archivo JSON
 * @returns {Promise<string[]>}
 */
export async function cargarRuts() {
    // Intentamos leer el archivo JSON
    try {
        const rutFile = await fsp.readFile('ruts_masivos.json', 'utf-8');
        const rutData = JSON.parse(rutFile);
        return rutData.ruts || [];
    } catch (error) {
        console.error('Error al cargar ruts_masivos.json:', error.message);
        // Si falla, retornamos array vacío
        return [];
    }
}
