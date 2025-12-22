import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { AuthRequest, requireAuth } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';

const router = Router();

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';

// POST /api/auth/sync - Sync Supabase user with local database
router.post('/sync', async (req: AuthRequest, res) => {
  try {
    const authHeader = req.headers.authorization;
    console.log('Auth sync called, has auth header:', !!authHeader);
    
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    console.log('Token length:', token?.length);
    
    try {
      let supabaseUserId: string;
      let email: string | undefined;

      // Try to verify with Supabase first
      console.log('Attempting Supabase getUser...');
      const { data, error: supabaseError } = await supabase.auth.getUser(token);
      console.log('Supabase getUser result:', { hasUser: !!data?.user, error: supabaseError?.message });
      
      if (data?.user && !supabaseError) {
        supabaseUserId = data.user.id;
        email = data.user.email;
        console.log('Supabase verified user:', supabaseUserId, email);
      } else if (SUPABASE_JWT_SECRET) {
        // Fallback to manual JWT verification
        console.log('Falling back to manual JWT verification...');
        const decoded = jwt.verify(token, SUPABASE_JWT_SECRET, {
          algorithms: ['HS256']
        }) as { sub: string; email?: string };
        supabaseUserId = decoded.sub;
        email = decoded.email || req.body.email;
        console.log('JWT verified user:', supabaseUserId, email);
      } else {
        console.error('Supabase auth failed and no JWT secret:', supabaseError);
        return res.status(401).json({ error: 'Token verification failed' });
      }
      
      email = email || req.body.email;
      const name = req.body.name;

      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      console.log('Looking up user with supabaseId:', supabaseUserId, 'or email:', email);

      // Find or create user
      let user = await prisma.user.findFirst({
        where: { 
          OR: [
            { supabaseId: supabaseUserId },
            { email: email }
          ]
        }
      });

      console.log('Found existing user:', !!user);

      if (!user) {
        // Create new user
        console.log('Creating new user...');
        user = await prisma.user.create({
          data: {
            email,
            name: name || email.split('@')[0],
            passwordHash: '',
            supabaseId: supabaseUserId
          }
        });
        console.log('Created user:', user.id);
      } else if (!user.supabaseId) {
        // Link existing user to Supabase
        console.log('Linking existing user to Supabase...');
        user = await prisma.user.update({
          where: { id: user.id },
          data: { 
            supabaseId: supabaseUserId,
            name: name || user.name
          }
        });
      }

      // Check weekly upload reset
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      if (user.lastUploadReset < oneWeekAgo && user.plan === 'FREE') {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            uploadCount: 0,
            lastUploadReset: new Date()
          }
        });
        user.uploadCount = 0;
      }

      console.log('Sync successful for user:', user.id);

      res.json({
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        plan: user.plan,
        uploadCount: user.uploadCount
      });
    } catch (err: any) {
      console.error('Token verification failed:', err.message, err.stack);
      return res.status(401).json({ error: 'Invalid token', details: err.message });
    }
  } catch (error: any) {
    console.error('Sync error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to sync user', details: error.message });
  }
});

// GET /api/auth/me - Get current user
router.get('/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      include: {
        subscriptions: {
          where: { active: true },
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      plan: user.plan,
      uploadCount: user.uploadCount,
      subscription: user.subscriptions[0] || null
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// POST /api/auth/change-password - Not available with Supabase
router.post('/change-password', (req, res) => {
  res.status(400).json({ 
    error: 'Password changes are managed through Supabase',
    message: 'Use the password reset flow via email'
  });
});

export { router as authRouter };
