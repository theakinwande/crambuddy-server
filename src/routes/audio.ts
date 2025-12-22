import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { generateAudioScript } from '../lib/gemini.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';

const router = Router();

const audioDir = './audio';
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
}

// POST /api/audio/script - Generate audio script from document or topic (PREMIUM ONLY)
router.post('/script', requireAuth, async (req: AuthRequest, res) => {
  try {
    // Check if user has premium plan
    const user = await prisma.user.findUnique({
      where: { id: req.userId }
    });

    // TODO: restore for production
    // if (!user || user.plan !== 'PRO') {
    //   return res.status(403).json({ 
    //     error: 'Audio Cramming is a premium feature. Please upgrade to access.' 
    //   });
    // }

    const { documentId, topic } = req.body;

    if (!documentId && !topic) {
      return res.status(400).json({ error: 'Either documentId or topic is required' });
    }

    let summary = '';
    let topicName = topic || 'Study Summary';

    // If documentId provided, get document content
    if (documentId) {
      const document = await prisma.document.findFirst({
        where: { id: documentId, userId: req.userId },
        include: { chunks: { take: 5 } }
      });

      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }

      topicName = document.courseCode || document.originalName;
      summary = document.chunks.map(c => c.content).join('\n\n');
    } else {
      // Use topic only - generate generic summary
      summary = `Create an educational audio summary about: ${topic}. Cover key concepts, definitions, and important points.`;
    }

    // Generate spoken script using AI
    const script = await generateAudioScript(summary, topicName);

    res.json({
      script,
      topic: topicName,
      wordCount: script.split(/\s+/).length,
      estimatedMinutes: Math.ceil(script.split(/\s+/).length / 150)
    });
  } catch (error) {
    console.error('Script generation error:', error);
    res.status(500).json({ error: 'Failed to generate audio script' });
  }
});

// POST /api/audio/generate - Generate audio script for a topic
router.post('/generate', async (req, res) => {
  try {
    const { topic, summary, documentId } = req.body;

    if (!topic || !summary) {
      return res.status(400).json({ error: 'Topic and summary are required' });
    }

    // Generate spoken script
    const script = await generateAudioScript(summary, topic);

    // Estimate duration (roughly 150 words per minute)
    const wordCount = script.split(/\s+/).length;
    const estimatedDuration = Math.ceil((wordCount / 150) * 60);

    // Save audio file record
    const audioFile = await prisma.audioFile.create({
      data: {
        topicId: documentId || uuidv4(),
        filename: `${uuidv4()}.txt`, // Text script for now
        duration: estimatedDuration,
        script
      }
    });

    // Save script to file
    const scriptPath = path.join(audioDir, audioFile.filename);
    fs.writeFileSync(scriptPath, script);

    res.json({
      id: audioFile.id,
      topic,
      script,
      estimatedDuration,
      message: 'Audio script generated. TTS integration pending.'
    });
  } catch (error) {
    console.error('Audio generation error:', error);
    res.status(500).json({ error: 'Failed to generate audio' });
  }
});

// GET /api/audio/:id - Get audio file details
router.get('/:id', async (req, res) => {
  try {
    const audioFile = await prisma.audioFile.findUnique({
      where: { id: req.params.id }
    });

    if (!audioFile) {
      return res.status(404).json({ error: 'Audio file not found' });
    }

    res.json({
      id: audioFile.id,
      topicId: audioFile.topicId,
      duration: audioFile.duration,
      script: audioFile.script,
      createdAt: audioFile.createdAt
    });
  } catch (error) {
    console.error('Get audio error:', error);
    res.status(500).json({ error: 'Failed to get audio file' });
  }
});

// GET /api/audio - List all audio files
router.get('/', async (req, res) => {
  try {
    const audioFiles = await prisma.audioFile.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        topicId: true,
        duration: true,
        createdAt: true
      }
    });

    res.json(audioFiles);
  } catch (error) {
    console.error('List audio error:', error);
    res.status(500).json({ error: 'Failed to list audio files' });
  }
});

// DELETE /api/audio/:id - Delete audio file
router.delete('/:id', async (req, res) => {
  try {
    const audioFile = await prisma.audioFile.findUnique({
      where: { id: req.params.id }
    });

    if (!audioFile) {
      return res.status(404).json({ error: 'Audio file not found' });
    }

    // Delete file from disk
    const filePath = path.join(audioDir, audioFile.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await prisma.audioFile.delete({
      where: { id: req.params.id }
    });

    res.json({ message: 'Audio file deleted successfully' });
  } catch (error) {
    console.error('Delete audio error:', error);
    res.status(500).json({ error: 'Failed to delete audio file' });
  }
});

export { router as audioRouter };
