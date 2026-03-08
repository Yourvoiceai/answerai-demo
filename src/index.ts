import express from 'express';
import dotenv from 'dotenv';
import expressWs from 'express-ws';
import webhookRoutes from './routes/webhook-simple';
import { logger } from './utils/logger';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable WebSocket support
expressWs(app);

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, { 
    query: req.query,
    body: req.method === 'POST' ? { ...req.body, SpeechResult: req.body.SpeechResult ? '[REDACTED]' : undefined } : undefined
  });
  next();
});

// Routes
app.use('/webhook', webhookRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'AnswerAI Voice Demo',
    description: 'AI receptionist for trades contractors',
    endpoints: {
      health: '/health',
      voice: '/webhook/voice',
      status: '/webhook/status',
      auth: '/webhook/auth/url'
    }
  });
});

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  logger.info(`AnswerAI Voice Server running on port ${PORT}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
  logger.info(`Webhook URL: http://localhost:${PORT}/webhook/voice`);
});

export default app;
