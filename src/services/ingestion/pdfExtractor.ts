import fs from 'fs';
import pdf from 'pdf-parse';

export async function extractTextFromPdf(filePath: string): Promise<string> {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    
    // pdf-parse returns text property with extracted text
    return data.text || '';
  } catch (error) {
    console.error('PDF extraction error:', error);
    throw new Error('Failed to extract text from PDF');
  }
}

export function getPdfMetadata(filePath: string): Promise<{
  pages: number;
  info: Record<string, unknown>;
}> {
  return new Promise(async (resolve, reject) => {
    try {
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdf(dataBuffer);
      
      resolve({
        pages: data.numpages,
        info: data.info || {}
      });
    } catch (error) {
      reject(error);
    }
  });
}
