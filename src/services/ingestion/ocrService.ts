import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

// Preprocess image for better OCR results
async function preprocessImage(inputPath: string): Promise<string> {
  const outputPath = inputPath.replace(/\.[^.]+$/, '_processed.png');
  
  try {
    await sharp(inputPath)
      // Convert to grayscale
      .grayscale()
      // Increase contrast
      .normalize()
      // Sharpen
      .sharpen()
      // Resize if too small (improves OCR)
      .resize({
        width: 2000,
        height: 2000,
        fit: 'inside',
        withoutEnlargement: false
      })
      // Output as PNG
      .png()
      .toFile(outputPath);
    
    return outputPath;
  } catch (error) {
    console.warn('Image preprocessing failed, using original:', error);
    return inputPath;
  }
}

export async function extractTextFromImage(imagePath: string): Promise<string> {
  let processedPath = imagePath;
  
  try {
    // Preprocess the image
    processedPath = await preprocessImage(imagePath);
    
    // Run OCR
    const result = await Tesseract.recognize(processedPath, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          // Progress logging (optional)
        }
      }
    });
    
    // Cleanup processed file if different from original
    if (processedPath !== imagePath && fs.existsSync(processedPath)) {
      fs.unlinkSync(processedPath);
    }
    
    return result.data.text || '';
  } catch (error) {
    console.error('OCR error:', error);
    
    // Cleanup on error
    if (processedPath !== imagePath && fs.existsSync(processedPath)) {
      fs.unlinkSync(processedPath);
    }
    
    throw new Error('Failed to extract text from image');
  }
}

// Get OCR confidence score
export async function getOcrConfidence(imagePath: string): Promise<number> {
  try {
    const result = await Tesseract.recognize(imagePath, 'eng');
    return result.data.confidence;
  } catch (error) {
    return 0;
  }
}
