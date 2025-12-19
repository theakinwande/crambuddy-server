import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { analyzePatterns } from '../services/analyzer/patternAnalyzer.js';
import { generateExamStrategy } from '../lib/gemini.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();

// POST /api/analysis/run - Run analysis on uploaded PQs (PREMIUM ONLY)
router.post('/run', requireAuth, async (req: AuthRequest, res) => {
  try {
    // Check if user has premium plan
    const user = await prisma.user.findUnique({
      where: { id: req.userId }
    });

    if (!user || user.plan !== 'PRO') {
      return res.status(403).json({ 
        error: 'Exam Strategy is a premium feature. Please upgrade to access.' 
      });
    }

    const { documentIds, courseCode } = req.body;

    if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
      return res.status(400).json({ error: 'documentIds array is required' });
    }

    // Get documents with their chunks
    const documents = await prisma.document.findMany({
      where: {
        id: { in: documentIds },
        sourceType: 'pq'
      },
      include: {
        chunks: true
      }
    });

    if (documents.length === 0) {
      return res.status(404).json({ error: 'No past question documents found' });
    }

    // Analyze patterns
    const { topicFrequency, sectionBias } = await analyzePatterns(documents);

    // Generate AI strategy
    const strategy = await generateExamStrategy(topicFrequency, sectionBias);

    // Save analysis
    const analysis = await prisma.analysis.create({
      data: {
        documentId: documents[0].id,
        courseCode: courseCode || 'UNKNOWN',
        topics: JSON.stringify(Object.keys(topicFrequency)),
        frequency: JSON.stringify(topicFrequency),
        strategy
      }
    });

    res.json({
      id: analysis.id,
      courseCode: analysis.courseCode,
      topTopics: Object.entries(topicFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
      sectionBias,
      strategy,
      documentsAnalyzed: documents.length
    });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Failed to run analysis' });
  }
});

// GET /api/analysis/:courseCode - Get analysis for a course
router.get('/:courseCode', async (req, res) => {
  try {
    const analyses = await prisma.analysis.findMany({
      where: { courseCode: req.params.courseCode },
      orderBy: { createdAt: 'desc' },
      take: 1
    });

    if (analyses.length === 0) {
      return res.status(404).json({ error: 'No analysis found for this course' });
    }

    const analysis = analyses[0];
    
    res.json({
      id: analysis.id,
      courseCode: analysis.courseCode,
      topTopics: Object.entries(JSON.parse(analysis.frequency))
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .slice(0, 10),
      allTopics: JSON.parse(analysis.topics),
      strategy: analysis.strategy,
      createdAt: analysis.createdAt
    });
  } catch (error) {
    console.error('Get analysis error:', error);
    res.status(500).json({ error: 'Failed to get analysis' });
  }
});

// GET /api/analysis - List all analyses
router.get('/', async (req, res) => {
  try {
    const analyses = await prisma.analysis.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        courseCode: true,
        createdAt: true,
        document: {
          select: {
            originalName: true
          }
        }
      }
    });

    res.json(analyses);
  } catch (error) {
    console.error('List analyses error:', error);
    res.status(500).json({ error: 'Failed to list analyses' });
  }
});

export { router as analysisRouter };
