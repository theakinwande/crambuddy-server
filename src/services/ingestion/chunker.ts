// Text chunking for RAG
// Splits text into semantic chunks for embedding and retrieval

const DEFAULT_CHUNK_SIZE = 500; // characters
const DEFAULT_OVERLAP = 50; // characters

export function chunkText(
  text: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  overlap: number = DEFAULT_OVERLAP
): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  // Clean the text
  const cleanedText = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Try to split by paragraphs first
  const paragraphs = cleanedText.split(/\n\n+/);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();
    
    if (!trimmedParagraph) continue;

    // If paragraph fits in current chunk
    if (currentChunk.length + trimmedParagraph.length + 2 <= chunkSize) {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmedParagraph;
    } else {
      // Save current chunk if not empty
      if (currentChunk) {
        chunks.push(currentChunk);
      }

      // If paragraph itself is too long, split it
      if (trimmedParagraph.length > chunkSize) {
        const subChunks = splitLongParagraph(trimmedParagraph, chunkSize, overlap);
        chunks.push(...subChunks.slice(0, -1));
        currentChunk = subChunks[subChunks.length - 1] || '';
      } else {
        currentChunk = trimmedParagraph;
      }
    }
  }

  // Don't forget the last chunk
  if (currentChunk) {
    chunks.push(currentChunk);
  }

  // Apply overlap between chunks
  return applyOverlap(chunks, overlap);
}

function splitLongParagraph(
  text: string,
  chunkSize: number,
  overlap: number
): string[] {
  const chunks: string[] = [];
  
  // Try to split by sentences
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let currentChunk = '';

  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    
    if (currentChunk.length + trimmedSentence.length + 1 <= chunkSize) {
      currentChunk += (currentChunk ? ' ' : '') + trimmedSentence;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      
      // If sentence itself is too long, hard split
      if (trimmedSentence.length > chunkSize) {
        const hardChunks = hardSplit(trimmedSentence, chunkSize);
        chunks.push(...hardChunks.slice(0, -1));
        currentChunk = hardChunks[hardChunks.length - 1] || '';
      } else {
        currentChunk = trimmedSentence;
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function hardSplit(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  
  return chunks;
}

function applyOverlap(chunks: string[], overlap: number): string[] {
  if (overlap <= 0 || chunks.length <= 1) {
    return chunks;
  }

  const overlappedChunks: string[] = [];
  
  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i];
    
    // Add overlap from previous chunk
    if (i > 0) {
      const prevChunk = chunks[i - 1];
      const overlapText = prevChunk.slice(-overlap);
      chunk = overlapText + ' ... ' + chunk;
    }
    
    overlappedChunks.push(chunk);
  }
  
  return overlappedChunks;
}

// Get optimal chunk size based on content type
export function getOptimalChunkSize(textLength: number, isHandout: boolean): number {
  if (isHandout) {
    // Larger chunks for handouts to preserve context
    return Math.min(800, Math.max(400, textLength / 10));
  }
  
  // Smaller chunks for PQs to isolate questions
  return Math.min(400, Math.max(200, textLength / 20));
}
