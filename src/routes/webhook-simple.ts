import { Router } from 'express';
import { logger } from '../utils/logger';
import { TwilioService } from '../services/twilio';
import { CallSession, TwilioWebhookBody, ConversationContext, CollectedData } from '../types';

const router = Router();

// In-memory session store
const sessions = new Map<string, CallSession>();
const contexts = new Map<string, ConversationContext>();

const twilioService = new TwilioService();

// Generate TwiML response with gather
function generateVoiceResponse(message: string, gather: boolean = true): string {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${message}</Say>
  ${gather ? `<Gather input="speech" timeout="5" speechTimeout="auto" action="/webhook/voice/respond" method="POST">
    <Say voice="Polly.Joanna">I'm listening. Go ahead.</Say>
  </Gather>` : ''}
  <Hangup/>
</Response>`;
  return twiml;
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
    
    contexts.set(CallSid, {
      stage: 'greeting',
      attempts: 0
    });

    // Greeting
    const greeting = "Hi! This is YourVoiceAI. I'm an AI assistant here to help. What can I do for you today?";
    
    res.type('text/xml');
    res.send(generateVoiceResponse(greeting, true));

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

// Handle speech response
router.post('/voice/respond', async (req, res) => {
  try {
    const { CallSid, SpeechResult, Confidence } = req.body;
    
    logger.info('Speech received', { CallSid, SpeechResult, Confidence });
    
    let response = "I heard you say: " + (SpeechResult || "something I didn't catch");
    
    if (SpeechResult) {
      // Simple response logic
      const lower = SpeechResult.toLowerCase();
      if (lower.includes('emergency') || lower.includes('urgent')) {
        response = "I understand this is urgent. Let me transfer you to someone right away.";
      } else if (lower.includes('schedule') || lower.includes('appointment') || lower.includes('book')) {
        response = "I can help you schedule an appointment. What service do you need?";
      } else if (lower.includes('price') || lower.includes('cost') || lower.includes('how much')) {
        response = "I'd be happy to discuss pricing. What's the best number to reach you at?";
      } else {
        response = "Thanks for that information. Let me get your details so we can help you. What's your name and the best number to reach you?";
      }
    }
    
    res.type('text/xml');
    res.send(generateVoiceResponse(response, true));

  } catch (error) {
    logger.error('Error in respond webhook', error);
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, I didn't catch that. Could you repeat?</Say>
  <Gather input="speech" timeout="5" speechTimeout="auto" action="/webhook/voice/respond" method="POST"/>
</Response>`);
  }
});

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

export default router;
