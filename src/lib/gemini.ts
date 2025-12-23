import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.GROQ_API_KEY) {
  console.warn('Warning: GROQ_API_KEY not set. AI features will not work.');
}

// Groq uses OpenAI-compatible API
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || '',
  baseURL: 'https://api.groq.com/openai/v1'
});

// Models to use (Groq's free tier)
const CHAT_MODEL = 'llama-3.1-8b-instant'; // Fast and free
const EMBEDDING_MODEL = 'text-embedding-3-small'; // Fallback - Groq doesn't have embeddings

// Note: Groq doesn't support embeddings, so we'll use a simple fallback
export async function generateEmbedding(text: string): Promise<number[]> {
  // Simple keyword-based "embedding" fallback
  // In production, you'd use a separate embedding service
  const words = text.toLowerCase().split(/\s+/);
  const uniqueWords = [...new Set(words)];
  
  // Create a simple hash-based vector (768 dimensions to match typical embeddings)
  const vector: number[] = new Array(768).fill(0);
  for (let i = 0; i < uniqueWords.length; i++) {
    const word = uniqueWords[i];
    for (let j = 0; j < word.length; j++) {
      const idx = (word.charCodeAt(j) * (i + 1) * (j + 1)) % 768;
      vector[idx] += 1 / uniqueWords.length;
    }
  }
  
  // Normalize
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return magnitude > 0 ? vector.map(v => v / magnitude) : vector;
}

// Generate chat response with RAG context
export async function generateChatResponse(
  query: string,
  context: string,
  mode: 'exam' | 'eli5' | 'gist' | 'brainy'
): Promise<string> {
  const modePrompts = {
    exam: `You are an exam preparation assistant for Nigerian university students. 
Answer formally and precisely, focusing on what would earn marks in an exam.
Use the lecturer's exact definitions and terminology from the provided context.
If the answer is not in the context, say "This topic is not covered in your uploaded materials."`,
    
    eli5: `You are a friendly tutor explaining concepts simply.
Break down complex ideas into simple terms a beginner can understand.
Use analogies and examples. Keep the lecturer's key definitions intact.
If the answer is not in the context, say "I don't have information on this from your notes."`,
    
    gist: `You are a Nigerian study buddy explaining in casual Pidgin English.
Make it easy to understand with Nigerian analogies and expressions.
Keep lecturer definitions accurate but explain them simply.
Be respectful - no slang that's too informal.
If the answer is not in the context, say "E no dey for your material o."
Example: "So basically, wetin this topic dey talk about na..."`,

    brainy: `You are a brilliant, all-knowing study assistant.
You can answer ANY question, even if it's not in the provided materials.
Give deep, insightful, and comprehensive answers. 
If information is in the context, use it to ground your answer. 
Otherwise, use your vast general knowledge to provide a stellar explanation.`
  };

  try {
    const isRAG = mode !== 'brainy';
    const systemPrompt = modePrompts[mode];
    
    const userPrompt = isRAG
      ? `CONTEXT FROM UPLOADED MATERIALS:\n${context}\n\nSTUDENT QUESTION:\n${query}\n\nProvide a helpful answer based ONLY on the context above:`
      : `CONTEXT (USE IF RELEVANT):\n${context}\n\nSTUDENT QUESTION:\n${query}\n\nProvide a brilliant and helpful answer:`;

    const response = await groq.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userPrompt
        }
      ],
      max_tokens: 1000,
      temperature: 0.7
    });
    
    return response.choices[0]?.message?.content || 'No response generated';
  } catch (error) {
    console.error('Chat generation error:', error);
    throw error;
  }
}

// Clean and reconstruct messy OCR text
export async function cleanOcrText(messyText: string): Promise<string> {
  try {
    const response = await groq.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        {
          role: 'system',
          content: `You are a text cleanup assistant. Clean and reconstruct OCR text while:
1. Fixing obvious spelling errors and OCR mistakes
2. Maintaining the original meaning and structure
3. Preserving technical terms, names, and definitions exactly
4. Keeping paragraph structure`
        },
        {
          role: 'user',
          content: `MESSY TEXT:\n${messyText}\n\nCLEANED TEXT:`
        }
      ],
      max_tokens: 2000,
      temperature: 0.3
    });
    
    return response.choices[0]?.message?.content || messyText;
  } catch (error) {
    console.error('Text cleanup error:', error);
    return messyText;
  }
}

// Extract topics from past questions
export async function extractTopicsFromPQ(questionText: string): Promise<string[]> {
  try {
    const response = await groq.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        {
          role: 'system',
          content: 'Analyze exam questions and identify main topics. Return ONLY a JSON array of topic strings.'
        },
        {
          role: 'user',
          content: `QUESTION:\n${questionText}\n\nTOPICS (return as JSON array):`
        }
      ],
      max_tokens: 500,
      temperature: 0.3
    });
    
    const text = response.choices[0]?.message?.content?.trim() || '[]';
    const match = text.match(/\[.*\]/s);
    if (match) {
      return JSON.parse(match[0]);
    }
    return [];
  } catch (error) {
    console.error('Topic extraction error:', error);
    return [];
  }
}

// Generate exam strategy
export async function generateExamStrategy(
  topicFrequency: Record<string, number>,
  sectionBias: Record<string, string[]>
): Promise<string> {
  try {
    const response = await groq.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are an exam strategy advisor for Nigerian university students.'
        },
        {
          role: 'user',
          content: `Based on this past question analysis, provide exam preparation strategy.

TOPIC FREQUENCY:
${JSON.stringify(topicFrequency, null, 2)}

SECTION PATTERNS:
${JSON.stringify(sectionBias, null, 2)}

Provide:
1. Top 5 topics to focus on
2. Section-wise preparation tips
3. Time allocation recommendations
4. "Hot" topics likely to appear`
        }
      ],
      max_tokens: 1000,
      temperature: 0.7
    });
    
    return response.choices[0]?.message?.content || 'Unable to generate strategy.';
  } catch (error) {
    console.error('Strategy generation error:', error);
    return 'Unable to generate strategy. Please try again.';
  }
}

// Generate audio script from summary
export async function generateAudioScript(summary: string, topic: string): Promise<string> {
  try {
    const response = await groq.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        {
          role: 'system',
          content: `Convert study summaries into natural spoken scripts for audio cramming.
Requirements:
- 1-3 minutes when read aloud
- Conversational but educational tone
- Include brief pauses (marked with "...")
- Emphasize key definitions
- End with a quick recap`
        },
        {
          role: 'user',
          content: `TOPIC: ${topic}\nSUMMARY: ${summary}\n\nAUDIO SCRIPT:`
        }
      ],
      max_tokens: 1500,
      temperature: 0.7
    });
    
    return response.choices[0]?.message?.content || 'Unable to generate script.';
  } catch (error) {
    console.error('Audio script error:', error);
    throw error;
  }
}
