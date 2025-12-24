// @ts-check
import { test } from '@playwright/test';
import { verificarFirma, cargarRuts } from './firma-utils.js';

let ruts = [];

// Cargamos los RUTs antes de ejecutar los tests
// Esto se ejecuta en "top-level await" (característica de ES modules)
ruts = await cargarRuts();

// Estos hooks están vacíos pero los dejamos por si acaso se necesitan después
test.beforeAll(async () => {});
test.afterAll(async () => {});

test('Procesamiento secuencial de firmas por RUT con Logging', async ({ page }) => {
    // Timeout dinámico: 30 segundos por cada RUT
    const timeoutPorRut = 30000;
    const timeoutTotal = ruts.length * timeoutPorRut;
    test.setTimeout(timeoutTotal);

    // Procesamos uno por uno (no en paralelo)
    for (const rut of ruts) {
        const resultado = await verificarFirma(rut, page);
        console.log(`RUT: ${rut} | Resultado: ${resultado.detalle}`);
    }
});
