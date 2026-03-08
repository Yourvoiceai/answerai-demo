import { Router } from 'express';
import { logger } from '../utils/logger';
import { TwilioService } from '../services/twilio';
import { CallSession, TwilioWebhookBody } from '../types';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const router = Router();

// In-memory session store
const sessions = new Map<string, CallSession>();

// Pre-generated audio cache
const audioCache = new Map<string, string>();

// Common responses to pre-generate
const COMMON_RESPONSES = [
  "Hi! This is YourVoiceAI. I'm an AI assistant here to help. What can I do for you today?",
  "I can help with that. What's your name and the best number to reach you?",
  "Got it. And what service do you need?",
  "Thanks for that. Is this an emergency or can it wait?",
  "Perfect. Someone will call you back within 24 hours. Is there anything else?",
  "I didn't catch that. Could you repeat?",
  "Thanks for calling YourVoiceAI. Have a great day!"
];

const twilioService = new TwilioService();

// Pre-generate common audio files on startup
async function pregenerateCommonAudio(): Promise<void> {
  logger.info('Pre-generating common audio responses...');
  
  for (const text of COMMON_RESPONSES) {
    try {
      const hash = Buffer.from(text).toString('base64').substring(0, 16);
      const filename = `cached-${hash}.mp3`;
      const filepath = path.join('/tmp', filename);
      
      if (!fs.existsSync(filepath)) {
        const audioBuffer = await generateSpeech(text);
        fs.writeFileSync(filepath, audioBuffer);
        logger.info(`Generated cached audio: ${filename}`);
      }
      
      audioCache.set(text, filename);
    } catch (error) {
      logger.error('Failed to pre-generate audio', { text, error });
    }
  }
  
  logger.info('Audio pre-generation complete');
}

// Get cached audio or generate new
async function getAudioForText(text: string, callSid: string): Promise<string> {
  // Check cache first
  if (audioCache.has(text)) {
    const cachedFile = audioCache.get(text)!;
    const cachedPath = path.join('/tmp', cachedFile);
    if (fs.existsSync(cachedPath)) {
      logger.info('Using cached audio', { text: text.substring(0, 50) });
      return cachedFile;
    }
  }
  
  // Generate new audio
  logger.info('Generating new audio', { text: text.substring(0, 50) });
  const audioBuffer = await generateSpeech(text);
  const filename = `response-${callSid}-${Date.now()}.mp3`;
  const filepath = path.join('/tmp', filename);
  fs.writeFileSync(filepath, audioBuffer);
  
  return filename;
}

// OpenAI TTS function
async function generateSpeech(text: string): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'tts-1',
      voice: 'alloy',
      input: text,
      response_format: 'mp3'
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI TTS error: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer);
}

// OpenAI Chat function
async function getAIResponse(userMessage: string, context: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a warm, friendly AI receptionist for YourVoiceAI. You answer calls for contractors — electricians, plumbers, and HVAC pros.

Your personality: Warm, approachable, professional but not stiff. Like a helpful office manager who genuinely wants to solve problems.

Your job:
1. Greet callers warmly
2. Listen and collect: name, phone, what service they need, where they are, and how urgent it is
3. If it's an emergency, let them know you'll get someone on the line right away
4. For non-urgent stuff, take the details and tell them when to expect a callback

Keep responses concise (1-2 sentences). Speak naturally. Current context: ${context}`
        },
        {
          role: 'user',
          content: userMessage
        }
      ],
      max_tokens: 150
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI Chat error: ${response.status}`);
  }

  const data = await response.json() as any;
  return data.choices[0].message.content;
}

// Main voice webhook
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

    // Use cached greeting
    const greeting = "Hi! This is YourVoiceAI. I'm an AI assistant here to help. What can I do for you today?";
    const audioFileName = await getAudioForText(greeting, CallSid);

    // Return TwiML with Gather
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>https://answerai-demo-production.up.railway.app/audio/${audioFileName}</Play>
  <Gather input="speech" timeout="5" speechTimeout="auto" action="/webhook/voice/respond?callSid=${CallSid}" method="POST">
    <Pause length="1"/>
  </Gather>
</Response>`;
    
    res.type('text/xml');
    res.send(twiml);

  } catch (error) {
    logger.error('Error in voice webhook', error);
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Thanks for calling YourVoiceAI! I'm your AI assistant. How can I help you today?</Say>
  <Gather input="speech" timeout="5" speechTimeout="auto" action="/webhook/voice/respond" method="POST"/>
</Response>`);
  }
});

// Serve audio files
router.get('/audio/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join('/tmp', filename);
  
  if (fs.existsSync(filepath)) {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.sendFile(filepath);
  } else {
    res.status(404).send('Audio not found');
  }
});

// Handle speech response
router.post('/voice/respond', async (req, res) => {
  try {
    const { SpeechResult, Confidence } = req.body;
    const callSid = req.query.callSid as string;
    
    logger.info('Speech received', { callSid, SpeechResult, Confidence });
    
    let aiResponse: string;
    
    if (SpeechResult) {
      // Get AI response from OpenAI
      aiResponse = await getAIResponse(SpeechResult, 'Initial greeting');
    } else {
      aiResponse = "I didn't catch that. Could you tell me what service you need?";
    }
    
    // Get cached or generate new audio
    const audioFileName = await getAudioForText(aiResponse, callSid);
    
    // Return TwiML
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>https://answerai-demo-production.up.railway.app/audio/${audioFileName}</Play>
  <Gather input="speech" timeout="5" speechTimeout="auto" action="/webhook/voice/respond?callSid=${callSid}" method="POST">
    <Pause length="1"/>
  </Gather>
</Response>`;
    
    res.type('text/xml');
    res.send(twiml);

  } catch (error) {
    logger.error('Error in respond webhook', error);
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Sorry, I didn't catch that. Could you repeat?</Say>
  <Gather input="speech" timeout="5" speechTimeout="auto" action="/webhook/voice/respond" method="POST"/>
</Response>`);
  }
});

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0', voice: 'openai-alloy' });
});

// Pre-generate audio on module load
pregenerateCommonAudio().catch(error => {
  logger.error('Failed to pre-generate audio on startup', error);
});

export default router;
