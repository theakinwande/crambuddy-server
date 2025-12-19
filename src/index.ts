import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { uploadRouter } from './routes/upload.js';
import { chatRouter } from './routes/chat.js';
import { analysisRouter } from './routes/analysis.js';
import { audioRouter } from './routes/audio.js';
import { authRouter } from './routes/auth.js';
import { paymentsRouter } from './routes/payments.js';
import { cleanupExpiredSubscriptions } from './lib/subscriptions.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://your-frontend-domain.com', 'https://your-prelaunch-domain.com']
    : ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/chat', chatRouter);
app.use('/api/analysis', analysisRouter);
app.use('/api/audio', audioRouter);

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, async () => {
  console.log(`🚀 CramBuddy Server running on http://localhost:${PORT}`);
  
  // Run subscription cleanup on startup
  try {
    const expiredCount = await cleanupExpiredSubscriptions();
    if (expiredCount > 0) {
      console.log(`📋 Cleaned up ${expiredCount} expired subscriptions`);
    }
  } catch (error) {
    console.error('Failed to cleanup subscriptions:', error);
  }
});
