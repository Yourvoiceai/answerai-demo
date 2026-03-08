import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import { logger } from './utils/logger';
import { TwilioService } from './services/twilio';

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Store OpenAI connections
const openaiConnections = new Map<string, WebSocket>();

// Create OpenAI Realtime connection
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
    let sessionConfigured = false;
    
    ws.on('open', () => {
      logger.info('OpenAI Realtime connected', { callSid });
      
      // Configure session
      const sessionConfig = {
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: `You are a warm, friendly AI receptionist for ${process.env.BUSINESS_NAME || 'YourVoiceAI'}. You answer calls for contractors — electricians, plumbers, and HVAC pros.

Your personality: Warm, approachable, professional but not stiff. Like a helpful office manager who genuinely wants to solve problems.

Your job:
1. Greet callers warmly: "Thanks for calling YourVoiceAI! I'm your AI assistant. How can I help you today?"
2. Listen and collect: name, phone, what service they need, where they are, and how urgent it is
3. If it's an emergency, let them know you'll get someone on the line right away
4. For non-urgent stuff, take the details and tell them when to expect a callback

Speak naturally — use contractions, pause like a real person, and keep it conversational. Not robotic.`,
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
    });
    
    // Wait for session to be configured before resolving
    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        logger.info('OpenAI message during config', { callSid, type: msg.type });
        
        if (msg.type === 'session.updated' && !sessionConfigured) {
          sessionConfigured = true;
          logger.info('OpenAI session configured', { callSid });
          resolve(ws);
        }
        
        if (msg.type === 'error') {
          logger.error('OpenAI error during config', { callSid, error: msg.error });
        }
      } catch (e) {
        logger.error('Error parsing OpenAI message', { callSid, error: e });
      }
    });

    ws.on('error', (error) => {
      logger.error('OpenAI Realtime error', { callSid, error });
      reject(error);
    });
    
    // Timeout after 30 seconds
    setTimeout(() => {
      if (!sessionConfigured) {
        reject(new Error('Session configuration timeout'));
      }
    }, 30000);
  });
}

// Voice webhook - initiates the call
app.post('/webhook/voice', async (req, res) => {
  try {
    const { CallSid, From, To } = req.body;
    logger.info('Voice webhook received', { CallSid, From });

    // Return TwiML that connects to our WebSocket stream
    const host = req.headers.host || `localhost:${PORT}`;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${host}/stream" />
  </Connect>
</Response>`;
    
    res.type('text/xml');
    res.send(twiml);

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
wss.on('connection', (ws, req) => {
  logger.info('Media stream WebSocket connected');
  
  let callSid: string | null = null;
  let streamSid: string | null = null;
  let openaiWs: WebSocket | null = null;

  ws.on('message', async (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.event === 'start') {
        callSid = msg.start.callSid;
        streamSid = msg.start.streamSid;
        logger.info('Stream started', { callSid, streamSid });
        
        // Create OpenAI connection
        try {
          if (!callSid) {
            throw new Error('CallSid is null');
          }
          openaiWs = await createOpenAIConnection(callSid);
          openaiConnections.set(callSid, openaiWs);
          
          // Trigger AI to start speaking with a greeting
          setTimeout(() => {
            if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
              // Add a user message to trigger the assistant to respond
              openaiWs.send(JSON.stringify({
                type: 'conversation.item.create',
                item: {
                  type: 'message',
                  role: 'user',
                  content: [{ type: 'input_text', text: 'Hello' }]
                }
              }));
              
              // Then trigger a response
              openaiWs.send(JSON.stringify({
                type: 'response.create'
              }));
              
              logger.info('Triggered AI greeting', { callSid });
            }
          }, 500);
          
          // Handle messages from OpenAI
          openaiWs.on('message', (openaiData: Buffer) => {
            try {
              const response = JSON.parse(openaiData.toString());
              logger.info('OpenAI message received', { callSid, type: response.type });
              
              if ((response.type === 'response.audio.delta' || response.type === 'response.output_audio.delta') && response.delta && streamSid) {
                // Send audio back to Twilio
                const audioMsg = {
                  event: 'media',
                  streamSid: streamSid,
                  media: {
                    payload: response.delta
                  }
                };
                ws.send(JSON.stringify(audioMsg));
                logger.info('Sent audio to Twilio', { callSid, streamSid });
              }
              
              if (response.type === 'response.text.done') {
                logger.info('AI response text', { callSid, text: response.text });
              }
              
              if (response.type === 'error') {
                logger.error('OpenAI error', { callSid, error: response.error });
              }
            } catch (e) {
              logger.error('Error processing OpenAI message', e);
            }
          });
          
          openaiWs.on('close', () => {
            logger.info('OpenAI connection closed', { callSid });
            openaiConnections.delete(callSid || '');
          });
          
        } catch (error) {
          logger.error('Failed to create OpenAI connection', { callSid, error });
        }
      }
      
      if (msg.event === 'media' && openaiWs && msg.media && msg.media.payload) {
        // Forward audio from caller to OpenAI
        const audioAppend = {
          type: 'input_audio_buffer.append',
          audio: msg.media.payload
        };
        openaiWs.send(JSON.stringify(audioAppend));
      }
      
      if (msg.event === 'stop' && callSid) {
        logger.info('Stream stopped', { callSid });
        if (openaiWs) {
          openaiWs.close();
          openaiConnections.delete(callSid);
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

  ws.on('error', (error) => {
    logger.error('WebSocket error', { callSid, error });
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    realtime: true
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'YourVoiceAI - Realtime Voice Demo',
    description: 'AI receptionist for trades contractors using OpenAI Realtime API',
    endpoints: {
      health: '/health',
      voice: '/webhook/voice'
    }
  });
});

// Start server - bind to all interfaces for Railway
const PORT_NUM = parseInt(PORT as string, 10);
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT_NUM, HOST, () => {
  logger.info(`YourVoiceAI Realtime Server running on ${HOST}:${PORT_NUM}`);
  logger.info(`Health check: http://${HOST}:${PORT_NUM}/health`);
  logger.info(`Voice webhook: http://${HOST}:${PORT_NUM}/webhook/voice`);
});
