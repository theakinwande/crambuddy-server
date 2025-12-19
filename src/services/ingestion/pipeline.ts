import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma.js';
import { detectFileType } from './fileDetector.js';
import { extractTextFromPdf } from './pdfExtractor.js';
import { extractTextFromImage } from './ocrService.js';
import { transcribeAudio } from './sttService.js';
import { cleanOcrText, generateEmbedding } from '../../lib/gemini.js';
import { chunkText } from './chunker.js';

export async function processDocument(
  documentId: string,
  filePath: string,
  mimeType: string
): Promise<void> {
  console.log(`Processing document ${documentId}...`);
  
  try {
    const fileType = detectFileType(mimeType);
    let rawText = '';
    let confidence = 'medium';

    // Extract text based on file type
    switch (fileType) {
      case 'pdf':
        rawText = await extractTextFromPdf(filePath);
        break;
      case 'image':
        rawText = await extractTextFromImage(filePath);
        confidence = 'low'; // OCR is less reliable
        break;
      case 'audio':
        rawText = await transcribeAudio(filePath);
        confidence = 'low'; // STT is less reliable
        break;
      default:
        throw new Error(`Unsupported file type: ${mimeType}`);
    }

    if (!rawText || rawText.trim().length === 0) {
      console.warn(`No text extracted from document ${documentId}`);
      await prisma.document.update({
        where: { id: documentId },
        data: { 
          rawText: '', 
          cleanedText: '',
          confidence: 'low'
        }
      });
      return;
    }

    // Clean text using AI if it looks messy
    let cleanedText = rawText;
    if (fileType === 'image' || fileType === 'audio') {
      try {
        cleanedText = await cleanOcrText(rawText);
        confidence = 'medium'; // AI cleanup improves confidence
      } catch (error) {
        console.warn('AI cleanup failed, using raw text');
        cleanedText = rawText;
      }
    }

    // Update document with extracted text
    await prisma.document.update({
      where: { id: documentId },
      data: {
        rawText,
        cleanedText,
        confidence
      }
    });

    // Chunk the text
    const chunks = chunkText(cleanedText);
    console.log(`Created ${chunks.length} chunks for document ${documentId}`);

    // Generate embeddings and store chunks
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      let embedding: number[] | null = null;

      try {
        embedding = await generateEmbedding(chunk);
      } catch (error) {
        console.warn(`Failed to generate embedding for chunk ${i}`);
      }

      await prisma.chunk.create({
        data: {
          documentId,
          content: chunk,
          embedding: embedding ? JSON.stringify(embedding) : null,
          chunkIndex: i
        }
      });
    }

    console.log(`Document ${documentId} processed successfully`);
  } catch (error) {
    console.error(`Error processing document ${documentId}:`, error);
    
    // Update document with error state
    await prisma.document.update({
      where: { id: documentId },
      data: { confidence: 'low' }
    });
  }
}
