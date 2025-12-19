import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma.js';
import { processDocument } from '../services/ingestion/pipeline.js';
import { requireAuth, checkUploadQuota, AuthRequest } from '../middleware/auth.js';

const router = Router();

// Ensure upload directory exists
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '47185920') // 45MB default
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
      'audio/webm'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not supported`));
    }
  }
});

// POST /api/upload - Upload a file (requires auth)
router.post('/', requireAuth, checkUploadQuota, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { courseCode, sourceType = 'handout' } = req.body;

    // Create document record with userId
    const document = await prisma.document.create({
      data: {
        userId: req.userId!,
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        courseCode: courseCode || null,
        sourceType: sourceType
      }
    });

    // Increment upload count for user
    await prisma.user.update({
      where: { id: req.userId! },
      data: { uploadCount: { increment: 1 } }
    });

    // Process document asynchronously
    processDocument(document.id, req.file.path, req.file.mimetype)
      .catch(err => console.error('Processing error:', err));

    res.status(201).json({
      id: document.id,
      filename: document.originalName,
      status: 'processing',
      message: 'File uploaded successfully. Processing in background.'
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// GET /api/upload/documents - List all documents
router.get('/documents', async (req, res) => {
  try {
    const documents = await prisma.document.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        courseCode: true,
        sourceType: true,
        confidence: true,
        createdAt: true,
        _count: {
          select: { chunks: true }
        }
      }
    });

    res.json(documents);
  } catch (error) {
    console.error('List documents error:', error);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

// GET /api/upload/documents/:id - Get document details
router.get('/documents/:id', async (req, res) => {
  try {
    const document = await prisma.document.findUnique({
      where: { id: req.params.id },
      include: {
        chunks: {
          select: {
            id: true,
            chunkIndex: true,
            content: true
          },
          orderBy: { chunkIndex: 'asc' }
        }
      }
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json(document);
  } catch (error) {
    console.error('Get document error:', error);
    res.status(500).json({ error: 'Failed to get document' });
  }
});

// DELETE /api/upload/documents/:id - Delete a document
router.delete('/documents/:id', async (req, res) => {
  try {
    const document = await prisma.document.findUnique({
      where: { id: req.params.id }
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Delete file from disk
    const filePath = path.join(uploadDir, document.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Delete from database (cascades to chunks)
    await prisma.document.delete({
      where: { id: req.params.id }
    });

    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

export { router as uploadRouter };
