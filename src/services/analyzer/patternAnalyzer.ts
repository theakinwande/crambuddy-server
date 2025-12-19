import { extractTopicsFromPQ } from '../../lib/gemini.js';

interface DocumentWithChunks {
  id: string;
  courseCode: string | null;
  chunks: { content: string }[];
}

export async function analyzePatterns(
  documents: DocumentWithChunks[]
): Promise<{
  topicFrequency: Record<string, number>;
  sectionBias: Record<string, string[]>;
}> {
  const topicFrequency: Record<string, number> = {};
  const sectionBias: Record<string, string[]> = {
    'Section A': [],
    'Section B': [],
    'Section C': []
  };

  for (const doc of documents) {
    // Combine all chunks from document
    const fullText = doc.chunks.map(c => c.content).join('\n\n');
    
    // Detect sections in text
    const sections = detectSections(fullText);
    
    // Extract topics from each section
    for (const [sectionName, sectionContent] of Object.entries(sections)) {
      if (!sectionContent) continue;
      
      try {
        const topics = await extractTopicsFromPQ(sectionContent);
        
        for (const topic of topics) {
          const normalizedTopic = topic.trim().toLowerCase();
          
          // Update frequency
          topicFrequency[normalizedTopic] = (topicFrequency[normalizedTopic] || 0) + 1;
          
          // Update section bias
          if (sectionBias[sectionName] && !sectionBias[sectionName].includes(normalizedTopic)) {
            sectionBias[sectionName].push(normalizedTopic);
          }
        }
      } catch (error) {
        console.warn(`Failed to extract topics from ${sectionName}:`, error);
      }
    }
  }

  return { topicFrequency, sectionBias };
}

function detectSections(text: string): Record<string, string> {
  const sections: Record<string, string> = {};
  
  // Common section patterns in Nigerian exam papers
  const sectionPatterns = [
    /section\s*a[:\s]/i,
    /section\s*b[:\s]/i,
    /section\s*c[:\s]/i,
    /part\s*a[:\s]/i,
    /part\s*b[:\s]/i,
    /part\s*c[:\s]/i
  ];

  // Try to split by sections
  const sectionAMatch = text.match(/section\s*a[:\s]*([\s\S]*?)(?=section\s*b|$)/i);
  const sectionBMatch = text.match(/section\s*b[:\s]*([\s\S]*?)(?=section\s*c|$)/i);
  const sectionCMatch = text.match(/section\s*c[:\s]*([\s\S]*?)$/i);

  if (sectionAMatch) sections['Section A'] = sectionAMatch[1].trim();
  if (sectionBMatch) sections['Section B'] = sectionBMatch[1].trim();
  if (sectionCMatch) sections['Section C'] = sectionCMatch[1].trim();

  // If no sections detected, treat whole text as one section
  if (Object.keys(sections).length === 0) {
    sections['General'] = text;
  }

  return sections;
}

// Identify repeated question patterns
export function findRepeatedPatterns(
  documents: DocumentWithChunks[]
): { pattern: string; count: number }[] {
  const questionPatterns: Record<string, number> = {};
  
  for (const doc of documents) {
    const fullText = doc.chunks.map(c => c.content).join('\n');
    
    // Extract questions (simple pattern matching)
    const questions = fullText.match(/(?:\d+[\.\)]\s*|[a-z][\.\)]\s*)[A-Z][^.?!]*[.?!]/g) || [];
    
    for (const question of questions) {
      // Normalize question for pattern matching
      const normalized = question
        .replace(/\d+/g, 'N') // Replace numbers with N
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
        .substring(0, 50); // First 50 chars as pattern
      
      questionPatterns[normalized] = (questionPatterns[normalized] || 0) + 1;
    }
  }

  // Return patterns that appear more than once
  return Object.entries(questionPatterns)
    .filter(([_, count]) => count > 1)
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count);
}
