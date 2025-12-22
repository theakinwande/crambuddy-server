import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { supabase } from '../lib/supabase.js';

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';

export interface AuthRequest extends Request {
  userId?: string;
  supabaseUserId?: string;
  user?: {
    id: string;
    email: string;
    plan: string;
    uploadCount: number;
  };
}

// Middleware to verify Supabase JWT token
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    
    try {
      // Try Supabase verification first
      const { data: { user: supabaseUser }, error: supabaseError } = await supabase.auth.getUser(token);
      
      let supabaseUserId: string;
      
      if (supabaseUser && !supabaseError) {
        supabaseUserId = supabaseUser.id;
      } else if (SUPABASE_JWT_SECRET) {
        // Fallback to manual JWT verification
        const decoded = jwt.verify(token, SUPABASE_JWT_SECRET, {
          algorithms: ['HS256']
        }) as { sub: string };
        supabaseUserId = decoded.sub;
      } else {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      
      // Find user by supabaseId
      let user = await prisma.user.findFirst({
        where: { supabaseId: supabaseUserId },
        select: {
          id: true,
          email: true,
          plan: true,
          uploadCount: true
        }
      });

      if (!user) {
        return res.status(401).json({ error: 'User not found. Please sync your account.' });
      }

      // Check subscription expiry for PRO users
      if (user.plan === 'PRO' || user.plan === 'WHATSAPP') {
        const activeSubscription = await prisma.subscription.findFirst({
          where: {
            userId: user.id,
            active: true,
            endDate: { gte: new Date() }
          }
        });

        if (!activeSubscription) {
          console.log(`Subscription expired for user ${user.id}, downgrading to FREE`);
          
          await prisma.subscription.updateMany({
            where: { userId: user.id, active: true },
            data: { active: false }
          });

          await prisma.user.update({
            where: { id: user.id },
            data: { plan: 'FREE' }
          });

          user.plan = 'FREE';
        }
      }

      req.userId = user.id;
      req.supabaseUserId = supabaseUserId;
      req.user = user;
      next();
    } catch (err) {
      console.error('JWT verification failed:', err);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// Optional auth - doesn't fail if no token
export async function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      
      try {
        const { data: { user: supabaseUser } } = await supabase.auth.getUser(token);
        
        if (supabaseUser) {
          const user = await prisma.user.findFirst({
            where: { supabaseId: supabaseUser.id },
            select: {
              id: true,
              email: true,
              plan: true,
              uploadCount: true
            }
          });

          if (user) {
            req.userId = user.id;
            req.supabaseUserId = supabaseUser.id;
            req.user = user;
          }
        }
      } catch {
        // Token invalid, continue without auth
      }
    }
    
    next();
  } catch (error) {
    next();
  }
}

// Middleware to check upload quota
export async function checkUploadQuota(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      return next();
    }

    const { plan, uploadCount } = req.user;
    
    if (plan === 'FREE' && uploadCount >= 2) {
      return res.status(403).json({
        error: 'Upload limit reached',
        message: 'Free tier allows 2 uploads per week. Upgrade to Pro for unlimited uploads.',
        upgradeUrl: '/dashboard'
      });
    }

    next();
  } catch (error) {
    console.error('Quota check error:', error);
    next();
  }
}

// Middleware to require Pro plan
export function requirePro(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.plan === 'FREE') {
    return res.status(403).json({
      error: 'Pro subscription required',
      message: 'This feature requires a Pro subscription.',
      upgradeUrl: '/dashboard'
    });
  }

  next();
}

// Middleware to require WhatsApp plan
export function requireWhatsApp(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.plan !== 'WHATSAPP') {
    return res.status(403).json({
      error: 'WhatsApp add-on required',
      message: 'This feature requires the WhatsApp add-on.',
      upgradeUrl: '/dashboard'
    });
  }

  next();
}
