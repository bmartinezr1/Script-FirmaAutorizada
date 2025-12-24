# 🔍 Validador de Firmas Autorizadas

Sistema automatizado de verificación de firmas de compromisos de confidencialidad mediante OCR.

## 📋 Descripción

Este script verifica automáticamente si un RUT tiene su documento de compromiso de confidencialidad firmado en el sistema INEG, utilizando Playwright para automatización web y Tesseract para reconocimiento óptico de caracteres (OCR).

## 📁 Estructura de Archivos

```
firma-validator/
├── test.spec.js          # Script principal
├── ruts_masivos.json     # Lista de RUTs a procesar
├── spa.traineddata       # Modelo OCR en español
├── eng.traineddata       # Modelo OCR en inglés
└── README.md             # Esta documentación
```

## 🚀 Uso

### **1. Instalación de dependencias** (en la raíz del proyecto):

```bash
npm install
```

### **2. Ejecución del script:**

#### Opción A: Desde archivo JSON
```bash
npx playwright test firma-validator/test.spec.js
```

#### Opción B: Con variable de entorno
```bash
$env:RUTS="18.684.711-3,19.234.567-8"
npx playwright test firma-validator/test.spec.js
```

#### Modo headless (sin interfaz gráfica):
```bash
npx playwright test firma-validator/test.spec.js --headed=false
```

## 📊 Salida

El script imprime por consola:

```
RUT: 18.684.711-3 | Resultado: Documento FIRMADO y autorizado | Tiempo_total = 4.23s
```

### Posibles resultados:

- ✅ `Documento FIRMADO y autorizado` - Firma válida detectada
- ❌ `Documento NO firmado` - Documento sin firma
- ⚠️ `NO EXISTE (mensaje)` - RUT no existe en el sistema
- ⚠️ `Tiempo excedido al buscar el compromiso...` - RUT no registrado
- ⚠️ `Falló procesamiento OCR: ...` - Error técnico

## 🔧 Integración

### Uso programático en tu sistema:

```javascript
import { estaFirmado } from './firma-validator/test.spec.js';
import { chromium } from 'playwright';

async function validarFirma(rut) {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    const firmado = await estaFirmado(rut, page);
    
    await browser.close();
    
    return firmado; // true o false
}
```

## 📝 Configurar RUTs a procesar

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

## ⚡ Rendimiento

- **Tiempo promedio:** 4-4.5 segundos por RUT
- **Precisión OCR:** ~95% en imágenes claras
- **Timeout por RUT:** 30 segundos

## 🔍 Archivos Temporales

El script genera imágenes temporales que se eliminan automáticamente:
- `imagen_[RUT].png` - Screenshot original
- `imagen_proc_[RUT].png` - Imagen procesada (escala de grises)

**Ubicación:** Directorio donde se ejecuta el script

## 🛠️ Requisitos

- Node.js 18+
- Playwright
- Tesseract.js
- Sharp
- Acceso a red interna (http://172.30.30.2)

## 📌 Notas Técnicas

- **OCR:** Utiliza modelos `spa+eng` para mejor precisión
- **Timeouts optimizados:** Navegación 8s, modal 3s, imagen 5s
- **Manejo de errores:** Captura todos los casos (red, alertas, timeouts)
- **Exportable:** Función `estaFirmado()` para integración externa
