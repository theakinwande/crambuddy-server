import { prisma } from '../../lib/prisma.js';
import { generateEmbedding } from '../../lib/gemini.js';

interface ChunkWithScore {
  id: string;
  documentId: string;
  content: string;
  confidence: string;
  score: number;
}

// Cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

export async function retrieveRelevantChunks(
  query: string,
  courseCode?: string,
  topK: number = 5
): Promise<{
  chunks: ChunkWithScore[];
  confidence: string;
}> {
  try {
    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query);

    // Build where clause
    const whereClause: Record<string, unknown> = {
      embedding: { not: null }
    };

    // Get all chunks with embeddings
    const allChunks = await prisma.chunk.findMany({
      where: whereClause,
      include: {
        document: {
          select: {
            id: true,
            courseCode: true,
            confidence: true,
            sourceType: true
          }
        }
      }
    });

    // Filter by course if specified
    const filteredChunks = courseCode
      ? allChunks.filter(c => c.document.courseCode === courseCode)
      : allChunks;

    if (filteredChunks.length === 0) {
      return {
        chunks: [],
        confidence: 'low'
      };
    }

    // Calculate similarity scores
    const scoredChunks: ChunkWithScore[] = filteredChunks
      .map(chunk => {
        const chunkEmbedding = JSON.parse(chunk.embedding!) as number[];
        const score = cosineSimilarity(queryEmbedding, chunkEmbedding);
        
        return {
          id: chunk.id,
          documentId: chunk.documentId,
          content: chunk.content,
          confidence: chunk.document.confidence,
          score
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    // Determine overall confidence
    const avgScore = scoredChunks.reduce((sum, c) => sum + c.score, 0) / scoredChunks.length;
    let confidence = 'low';
    if (avgScore > 0.8) confidence = 'high';
    else if (avgScore > 0.5) confidence = 'medium';

    return {
      chunks: scoredChunks,
      confidence
    };
  } catch (error) {
    console.error('Retrieval error:', error);
    return {
      chunks: [],
      confidence: 'low'
    };
  }
}

// Search chunks by keyword (fallback when embeddings fail)
export async function searchChunksByKeyword(
  query: string,
  courseCode?: string,
  limit: number = 5
): Promise<ChunkWithScore[]> {
  const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);
  
  const chunks = await prisma.chunk.findMany({
    where: courseCode
      ? { document: { courseCode } }
      : undefined,
    include: {
      document: {
        select: {
          confidence: true
        }
      }
    }
  });

  // Simple keyword matching score
  const scored = chunks.map(chunk => {
    const contentLower = chunk.content.toLowerCase();
    let score = 0;
    
    for (const keyword of keywords) {
      if (contentLower.includes(keyword)) {
        score += 1;
      }
    }
    
    return {
      id: chunk.id,
      documentId: chunk.documentId,
      content: chunk.content,
      confidence: chunk.document.confidence,
      score: score / keywords.length
    };
  });

  return scored
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
