import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

const router = Router();

// POST /api/waitlist - Add email to waitlist
router.post('/', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    // Check if already on waitlist
    const existing = await prisma.waitlist.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existing) {
      return res.status(200).json({ 
        message: 'You\'re already on the waitlist!',
        alreadyExists: true 
      });
    }

    // Add to waitlist
    await prisma.waitlist.create({
      data: { email: email.toLowerCase() }
    });

    // Get updated count
    const count = await prisma.waitlist.count();

    res.status(201).json({ 
      message: 'You\'re on the list!',
      count 
    });
  } catch (error) {
    console.error('Waitlist error:', error);
    res.status(500).json({ error: 'Failed to join waitlist' });
  }
});

// GET /api/waitlist/count - Get waitlist count (public)
router.get('/count', async (req, res) => {
  try {
    const count = await prisma.waitlist.count();
    res.json({ count });
  } catch (error) {
    console.error('Waitlist count error:', error);
    res.status(500).json({ error: 'Failed to get count' });
  }
});

export { router as waitlistRouter };
