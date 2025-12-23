// @ts-check
import { test, expect } from '@playwright/test';
import Tesseract from 'tesseract.js';
const sharp = require('sharp');


 const rut = '18.684.711-3'

test('Test firma autorizada rut', async ({ page }) => {
  await page.goto('http://172.30.30.2/ineg/nuevo/');
  await page.locator('#rut').click();
  await page.locator('#rut').fill(rut);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.getByRole('link', { name: 'Compromiso de Confidencialidad' }).dblclick();
  await page.waitForTimeout(1500); 
  // Selecciona la imagen y toma una captura de pantalla
  const image = await page.getByRole('rowgroup').getByRole('img');
  await image.screenshot({ path: 'imagen.png' });



  // Depuración: verificar que la imagen original existe


  // Procesamiento de imagen: solo escala de grises para depuración
  await sharp('imagen.png')
    .greyscale()
    .toFile('imagen_proc.png');



  // Usa Tesseract.js para leer el texto de la imagen procesada
  try {
    const result = await Tesseract.recognize('imagen_proc.png', 'spa+eng');


    if (result.data.text.includes('FIRMA AUTORIZADA') && result.data.text.includes('SERVICIO DE SALUD THNO')){
      console.log('El documento esta firmado y autorizado');
    }else{
      console.log('El documento no esta firmado')
    }
  } catch (error) {
    console.log('Error al procesar la imagen con Tesseract.js:', error);
  }

  


});
