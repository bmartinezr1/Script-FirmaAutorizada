# Validador de Firmas Autorizadas - Sistema Interno

Sistema automatizado para verificar si los compromisos de confidencialidad están firmados mediante OCR (Tesseract) y automatización web (Playwright).

## ¿Qué hace esto?

Básicamente, se conecta al sistema interno de INEG, busca el documento de "Compromiso de Confidencialidad" de cada RUT, captura una imagen y usa OCR para detectar si aparece el texto "FIRMA AUTORIZADA". 

Es útil cuando necesitas validar masivamente si los empleados tienen sus documentos firmados sin hacerlo uno por uno manualmente.

## Estructura del proyecto

```
firma-autorizada/
├── ejecutor.js              # Script principal CLI (úsalo desde terminal)
├── firma-utils.js           # Funciones de verificación y OCR
├── validador.spec.js        # Tests de Playwright (alternativa al ejecutor)
├── ruts_masivos.json        # Archivo con lista de RUTs a validar
├── package.json             # Dependencias del proyecto
├── eng.traineddata          # Modelo OCR inglés
└── spa.traineddata          # Modelo OCR español
```

## Instalación

```bash
# Instalar dependencias
npm install

# Instalar navegador Chromium para Playwright
npx playwright install chromium
```

## Formas de uso

### 1. Ejecutor CLI (recomendado para producción)

El ejecutor guarda los resultados en un archivo JSON automáticamente.

```bash
# Un solo RUT
node ejecutor.js "18.684.711-3"

# Múltiples RUTs separados por coma
node ejecutor.js "18.684.711-3,19.234.567-8,20.123.456-7"

# Sin argumentos (lee desde ruts_masivos.json)
node ejecutor.js
```

**Salida:**
```json
{"rut":"18.684.711-3","detalle":"Documento FIRMADO y autorizado","firmado":true}
{"rut":"19.234.567-8","detalle":"RUT no existe en el sistema: Rut incorrecto","firmado":false}

RESUMEN: 1 firmados | 1 no firmados
Resultados guardados en: resultados_1735098123456.json
```

### 2. Tests de Playwright (para debug con interfaz)

```bash
# Con interfaz visible
npx playwright test validador.spec.js --headed

# Sin interfaz (más rápido)
npx playwright test validador.spec.js

# Con variable de entorno
$env:RUTS="18.684.711-3,19.234.567-8"
npx playwright test validador.spec.js
```

### 3. Configurar RUTs en archivo JSON

Edita `ruts_masivos.json`:

```json
{
  "ruts": [
    "18.684.711-3",
    "19.234.567-8",
    "20.123.456-7"
  ]
}
```

Luego ejecuta sin argumentos:
```bash
node ejecutor.js
```

## Cómo funciona internamente

1. **Navegación**: Usa Playwright para abrir el sistema INEG en http://172.30.30.2/ineg/nuevo/
2. **Ingreso de RUT**: Llena el formulario y hace click en "Ingresar"
3. **Detección de errores**: Intercepta alerts de JavaScript para detectar RUTs inválidos
4. **Búsqueda de documento**: Hace doble click en el link "Compromiso de Confidencialidad"
5. **Captura de imagen**: Toma un screenshot de la imagen del documento
6. **Procesamiento OCR**: 
   - Convierte la imagen a escala de grises con Sharp
   - Ejecuta Tesseract con modelos español + inglés
   - Busca el texto "FIRMA AUTORIZADA" y "SERVICIO DE SALUD THNO"
7. **Limpieza**: Elimina las imágenes temporales

## Estados posibles

| Estado | Descripción |
|--------|-------------|
| `autorizado` | Documento firmado correctamente |
| `no_firmado` | Documento existe pero sin firma |
| `no_registro` | RUT no tiene registro en el sistema |
| `no_existe` | RUT no existe (alert del sistema) |
| `fallo_ocr` | Error al procesar la imagen con OCR |

## Integración con otros lenguajes

### Desde PHP

```php
$rut = "18.684.711-3";
$output = shell_exec("node ejecutor.js \"$rut\"");
$lines = explode("\n", trim($output));
$resultado = json_decode($lines[0], true);

if ($resultado['firmado']) {
    echo "Firmado!";
} else {
    echo "No firmado: " . $resultado['detalle'];
}
```

### Desde Python

```python
import subprocess
import json

rut = "18.684.711-3"
result = subprocess.run(
    ["node", "ejecutor.js", rut], 
    capture_output=True, 
    text=True
)

# La primera línea es el JSON del resultado
resultado = json.loads(result.stdout.split('\n')[0])
print(f"Firmado: {resultado['firmado']}")
```

## Notas importantes

- **Red interna**: Solo funciona dentro de la red porque usa http://172.30.30.2
- **Rendimiento**: Procesa aproximadamente 3-5 segundos por RUT
- **Archivos temporales**: Se crean imágenes `imagen_*.png` que se eliminan automáticamente
- **Archivos de resultados**: Se guardan como `resultados_[timestamp].json`
- **Headless mode**: Por defecto corre sin interfaz para ser más rápido

## Troubleshooting

### "Cannot find package 'playwright'"
```bash
npm install
```

### "Cannot find package '@playwright/test'"
```bash
npm install --save-dev @playwright/test
```

### "No browser found"
```bash
npx playwright install chromium
```

### Las imágenes no se detectan correctamente
- Verifica que los archivos `spa.traineddata` y `eng.traineddata` existan
- El OCR busca el texto exacto "FIRMA AUTORIZADA" y "SERVICIO DE SALUD THNO"
- Si cambia el formato del documento, hay que ajustar la búsqueda en `procesarImagenFirma()`

## Para estudiar el código

1. **Empieza por**: `ejecutor.js` - Es el punto de entrada, fácil de entender
2. **Luego revisa**: `firma-utils.js` - Aquí está toda la lógica importante
3. **Función clave**: `verificarFirma()` - Maneja todo el flujo de validación
4. **Parte más técnica**: `procesarImagenFirma()` - OCR con Tesseract + Sharp
5. **Tests**: `validador.spec.js` - Ejemplo de uso con Playwright Test Runner

## Dependencias

- **playwright**: Automatización del navegador
- **tesseract.js**: OCR para leer texto de imágenes
- **sharp**: Procesamiento de imágenes (conversión a escala de grises)
- **@playwright/test**: Framework de testing (solo dev)
