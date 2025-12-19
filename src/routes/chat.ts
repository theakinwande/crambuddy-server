import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { generateChatResponse } from '../lib/gemini.js';
import { retrieveRelevantChunks } from '../services/rag/retriever.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();

// POST /api/chat - Send a chat message (requires auth)
router.post('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { message, mode = 'exam', sessionId, courseCode } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get or create session for this user
    let session;
    if (sessionId) {
      session = await prisma.chatSession.findFirst({
        where: { id: sessionId, userId: req.userId }
      });
    }
    
    if (!session) {
      session = await prisma.chatSession.create({
        data: { 
          userId: req.userId!,
          title: message.substring(0, 50) 
        }
      });
    }

    // Save user message
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'user',
        content: message,
        mode
      }
    });

    // Retrieve relevant chunks (only from user's documents)
    const { chunks, confidence } = await retrieveRelevantChunks(message, courseCode);
    
    // Build context from chunks
    const context = chunks.map(c => c.content).join('\n\n---\n\n');
    
    // Generate AI response
    const response = await generateChatResponse(message, context, mode as 'exam' | 'eli5' | 'gist');

    // Build source citations
    const sources = chunks.map(chunk => ({
      documentId: chunk.documentId,
      excerpt: chunk.content.substring(0, 100) + '...',
      confidence: chunk.confidence
    }));

    // Save assistant message
    const assistantMessage = await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'assistant',
        content: response,
        mode,
        sources: JSON.stringify(sources),
        confidence
      }
    });

    res.json({
      sessionId: session.id,
      message: {
        id: assistantMessage.id,
        content: response,
        mode,
        sources,
        confidence
      }
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});

// GET /api/chat/sessions - List chat sessions
router.get('/sessions', async (req, res) => {
  try {
    const sessions = await prisma.chatSession.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { messages: true }
        }
      }
    });

    res.json(sessions);
  } catch (error) {
    console.error('List sessions error:', error);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// GET /api/chat/sessions/:id - Get session messages
router.get('/sessions/:id', async (req, res) => {
  try {
    const session = await prisma.chatSession.findUnique({
      where: { id: req.params.id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Parse sources JSON for each message
    const messagesWithSources = session.messages.map(msg => ({
      ...msg,
      sources: msg.sources ? JSON.parse(msg.sources) : null
    }));

    res.json({
      ...session,
      messages: messagesWithSources
    });
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// DELETE /api/chat/sessions/:id - Delete a session
router.delete('/sessions/:id', async (req, res) => {
  try {
    await prisma.chatSession.delete({
      where: { id: req.params.id }
    });

    res.json({ message: 'Session deleted successfully' });
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

export { router as chatRouter };
