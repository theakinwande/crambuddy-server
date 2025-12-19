import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-me';

export interface AuthRequest extends Request {
  userId?: string;
  user?: {
    id: string;
    email: string;
    plan: string;
    uploadCount: number;
  };
}

// Middleware to verify JWT token and check subscription expiry
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
      
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          email: true,
          plan: true,
          uploadCount: true
        }
      });

      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      // Check subscription expiry for PRO users
      if (user.plan === 'PRO' || user.plan === 'WHATSAPP') {
        const activeSubscription = await prisma.subscription.findFirst({
          where: {
            userId: user.id,
            active: true,
            endDate: { gte: new Date() } // Not expired
          }
        });

        // If no active subscription found, downgrade to FREE
        if (!activeSubscription) {
          console.log(`Subscription expired for user ${user.id}, downgrading to FREE`);
          
          // Deactivate all subscriptions
          await prisma.subscription.updateMany({
            where: { userId: user.id, active: true },
            data: { active: false }
          });

          // Downgrade user plan
          await prisma.user.update({
            where: { id: user.id },
            data: { plan: 'FREE' }
          });

          // Update the user object for this request
          user.plan = 'FREE';
        }
      }

      req.userId = user.id;
      req.user = user;
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// Optional auth - doesn't fail if no token, just sets user if present
export async function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
        
        const user = await prisma.user.findUnique({
          where: { id: decoded.userId },
          select: {
            id: true,
            email: true,
            plan: true,
            uploadCount: true
          }
        });

        if (user) {
          req.userId = user.id;
          req.user = user;
        }
      } catch {
        // Token invalid, but continue without auth
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
    // If no user, allow upload (guest mode)
    if (!req.user) {
      return next();
    }

    const { plan, uploadCount } = req.user;
    
    // Free tier: 2 uploads per week
    // Pro/WhatsApp: Unlimited
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
