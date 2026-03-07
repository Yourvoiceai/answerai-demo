import { Router } from 'express';
import WebSocket from 'ws';
import { logger } from '../utils/logger';
import { TwilioService } from '../services/twilio';
import { CalendarService } from '../services/calendar';
import { CallSession, TwilioWebhookBody, ConversationContext, CollectedData } from '../types';

const expressWs = require('express-ws');
const router = Router();
expressWs(router);

// In-memory session store (use Redis in production)
const sessions = new Map<string, CallSession>();
const contexts = new Map<string, ConversationContext>();
const openaiConnections = new Map<string, WebSocket>();

const twilioService = new TwilioService();

// Calendar service is optional for demo
let calendarService: CalendarService | null = null;
try {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    calendarService = new CalendarService();
    if (process.env.GOOGLE_ACCESS_TOKEN) {
      calendarService.setCredentials(
        process.env.GOOGLE_ACCESS_TOKEN,
        process.env.GOOGLE_REFRESH_TOKEN
      );
    }
  }
} catch (error) {
  logger.warn('Calendar service not initialized (optional for demo)');
}

// OpenAI Realtime API connection
async function createOpenAIConnection(callSid: string): Promise<WebSocket> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17', {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'OpenAI-Beta': 'realtime=v1'
    }
  });

  return new Promise((resolve, reject) => {
    ws.on('open', () => {
      logger.info('OpenAI Realtime connected for call', { callSid });
      
      // Configure session
      const sessionConfig = {
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: `You are a professional AI receptionist for ${process.env.BUSINESS_NAME || 'YourVoiceAI'}, a service that answers calls for contractors (electricians, plumbers, HVAC). 

Your job:
1. Greet callers warmly and professionally
2. Collect: name, phone, service needed, location/zip code, urgency level
3. For emergencies, offer to transfer immediately
4. For non-urgent requests, collect information and let them know someone will call back
5. Be conversational, natural, and helpful

Keep responses concise (1-2 sentences). Speak naturally with appropriate pauses.`,
          voice: 'alloy',
          input_audio_format: 'g711_ulaw',
          output_audio_format: 'g711_ulaw',
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500
          }
        }
      };
      
      ws.send(JSON.stringify(sessionConfig));
      resolve(ws);
    });

    ws.on('error', (error) => {
      logger.error('OpenAI Realtime error', { callSid, error });
      reject(error);
    });
  });
}

// Main voice webhook - handles incoming calls
router.post('/voice', async (req, res) => {
  try {
    const body = req.body as TwilioWebhookBody;
    const { CallSid, From, To } = body;

    logger.info('Voice webhook received', { CallSid, From });

    // Create session
    const session: CallSession = {
      callSid: CallSid,
      from: From,
      to: To,
      status: 'in-progress',
      startTime: new Date(),
      collectedData: {}
    };
    sessions.set(CallSid, session);
    
    contexts.set(CallSid, {
      stage: 'greeting',
      attempts: 0
    });

    // Return TwiML that connects to our WebSocket stream
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${req.headers.host}/webhook/stream" />
  </Connect>
</Response>`;
    
    res.type('text/xml');
    res.send(twiml);

    // Initialize OpenAI connection
    try {
      const openaiWs = await createOpenAIConnection(CallSid);
      openaiConnections.set(CallSid, openaiWs);
    } catch (error) {
      logger.error('Failed to create OpenAI connection', { CallSid, error });
    }

  } catch (error) {
    logger.error('Error in voice webhook', error);
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>We're experiencing technical difficulties. Please call back later.</Say>
  <Hangup/>
</Response>`);
  }
});

// WebSocket endpoint for media streaming
router.ws('/stream', (ws, req) => {
  logger.info('Media stream WebSocket connected');
  
  let callSid: string | null = null;
  let openaiWs: WebSocket | null = null;

  ws.on('message', async (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.event === 'start') {
        callSid = msg.start.callSid;
        if (!callSid) {
          logger.error('CallSid is null in stream start');
          return;
        }
        logger.info('Stream started', { callSid });
        
        // Get or create OpenAI connection
        openaiWs = openaiConnections.get(callSid) || null;
        
        if (openaiWs) {
          // Forward audio from Twilio to OpenAI
          openaiWs.on('message', (openaiData) => {
            try {
              const response = JSON.parse(openaiData.toString());
              
              if (response.type === 'response.audio.delta' && response.delta) {
                // Send audio back to Twilio
                const audioMsg = {
                  event: 'media',
                  streamSid: msg.start.streamSid,
                  media: {
                    payload: response.delta
                  }
                };
                ws.send(JSON.stringify(audioMsg));
              }
              
              if (response.type === 'response.text.done') {
                logger.info('AI response', { callSid, text: response.text });
              }
            } catch (e) {
              logger.error('Error processing OpenAI message', e);
            }
          });
        }
      }
      
      if (msg.event === 'media' && openaiWs && callSid) {
        // Forward audio from caller to OpenAI
        const audioAppend = {
          type: 'input_audio_buffer.append',
          audio: msg.media.payload
        };
        openaiWs.send(JSON.stringify(audioAppend));
      }
      
      if (msg.event === 'stop') {
        logger.info('Stream stopped', { callSid });
        if (openaiWs) {
          openaiWs.close();
          openaiConnections.delete(callSid || '');
        }
      }
    } catch (error) {
      logger.error('Error in stream message', error);
    }
  });

  ws.on('close', () => {
    logger.info('Media stream WebSocket closed', { callSid });
    if (openaiWs && callSid) {
      openaiWs.close();
      openaiConnections.delete(callSid);
    }
  });
});

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

export default router;
