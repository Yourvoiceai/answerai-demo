import { Router } from 'express';
import { TwilioService } from '../services/twilio';
import { OpenAIService } from '../services/openai';
import { CalendarService } from '../services/calendar';
import { logger } from '../utils/logger';
import { CallSession, TwilioWebhookBody, CollectedData, ConversationContext } from '../types';

const router = Router();

// In-memory session store (use Redis in production)
const sessions = new Map<string, CallSession>();
const contexts = new Map<string, ConversationContext>();

const twilioService = new TwilioService();
const openaiService = new OpenAIService();

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

// Main voice webhook - handles incoming calls
router.post('/voice', async (req, res) => {
  try {
    const body = req.body as TwilioWebhookBody;
    const { CallSid, From, To, CallStatus } = body;

    logger.info('Voice webhook received', { CallSid, From, CallStatus });

    // Get or create session
    let session = sessions.get(CallSid);
    
    if (!session) {
      // New call
      session = {
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

      // Initial greeting
      const businessName = process.env.BUSINESS_NAME || 'AnswerAI';
      const greeting = `Thanks for calling ${businessName}. I'm the AI assistant. How can I help you today?`;
      
      const twiml = twilioService.generateVoiceResponse(greeting, true);
      res.type('text/xml');
      res.send(twiml);
      return;
    }

    // Existing call - process speech input
    const speechResult = body.SpeechResult || '';
    const context = contexts.get(CallSid);

    if (!context) {
      logger.error('No context found for call', { CallSid });
      res.type('text/xml');
      res.send(twilioService.generateVoiceResponse('I apologize for the confusion. Let me transfer you.', false));
      return;
    }

    // Check for escalation keywords
    if (openaiService.shouldEscalate(speechResult)) {
      logger.info('Escalating call', { CallSid, reason: speechResult });
      
      // Send escalation SMS
      const escalationPhone = process.env.ESCALATION_PHONE;
      if (escalationPhone) {
        await twilioService.sendSMS(
          escalationPhone,
          twilioService.generateEscalationMessage({
            name: session.collectedData.name || 'Unknown',
            phone: From,
            serviceType: session.collectedData.serviceType,
            location: session.collectedData.location,
            urgency: session.collectedData.urgency
          })
        );
      }

      // Transfer call
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">I'll transfer you to someone right away. Please hold.</Say>
  <Dial>${process.env.ESCALATION_PHONE || ''}</Dial>
</Response>`;
      
      res.type('text/xml');
      res.send(twiml);
      return;
    }

    // Process based on conversation stage
    const response = await processConversationStage(session, context, speechResult);
    
    const twiml = twilioService.generateVoiceResponse(response, !context.stage.endsWith('complete'));
    res.type('text/xml');
    res.send(twiml);

  } catch (error) {
    logger.error('Error in voice webhook', error);
    res.type('text/xml');
    res.send(twilioService.generateVoiceResponse('I apologize for the error. Let me transfer you to a representative.', false));
  }
});

// Process conversation based on current stage
async function processConversationStage(
  session: CallSession,
  context: ConversationContext,
  input: string
): Promise<string> {
  const data = session.collectedData;
  
  switch (context.stage) {
    case 'greeting':
      // Extract service type from initial response
      if (input.toLowerCase().includes('electrical') || 
          input.toLowerCase().includes('electric')) {
        data.serviceType = 'Electrical';
      } else if (input.toLowerCase().includes('plumbing') || 
                 input.toLowerCase().includes('water') ||
                 input.toLowerCase().includes('leak')) {
        data.serviceType = 'Plumbing';
      } else if (input.toLowerCase().includes('hvac') || 
                 input.toLowerCase().includes('heat') ||
                 input.toLowerCase().includes('air')) {
        data.serviceType = 'HVAC';
      } else {
        data.serviceType = 'General Service';
      }
      
      context.stage = 'location';
      return `I can help with that ${data.serviceType?.toLowerCase() || 'service'} request. What's the address where you need service?`;

    case 'location':
      data.location = input;
      
      // Try to extract zip code
      const zipMatch = input.match(/\b\d{5}\b/);
      if (zipMatch) {
        data.zipCode = zipMatch[0];
      }
      
      context.stage = 'urgency';
      return `Got it. Is this an emergency that needs immediate attention, or can it wait for a scheduled appointment?`;

    case 'urgency':
      const lowerInput = input.toLowerCase();
      if (lowerInput.includes('emergency') || lowerInput.includes('urgent') || lowerInput.includes('now')) {
        data.urgency = 'emergency';
      } else if (lowerInput.includes('soon') || lowerInput.includes('this week')) {
        data.urgency = 'high';
      } else {
        data.urgency = 'medium';
      }
      
      context.stage = 'contact';
      return `Understood. May I have your name and the best phone number to reach you?`;

    case 'contact':
      // Try to extract name and phone
      data.name = input; // Simplified - in production, use better parsing
      data.phone = session.from; // Use caller ID as fallback
      
      // Try to find phone number in speech
      const phoneMatch = input.match(/(\d{3}[-.]?\d{3}[-.]?\d{4})/);
      if (phoneMatch) {
        data.phone = phoneMatch[0];
      }
      
      context.stage = 'scheduling';
      return `Thanks ${data.name?.split(' ')[0] || 'there'}. I can schedule you for the next available appointment. Would tomorrow or the day after work for you?`;

    case 'scheduling':
      // Parse date preference and find slot
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0);
      
      // Create appointment
      if (process.env.ENABLE_CALENDAR_BOOKING === 'true' && calendarService) {
        const appointment = await calendarService.createAppointment({
          summary: calendarService.generateAppointmentSummary(data.serviceType || 'Service', data.urgency),
          description: calendarService.generateAppointmentDescription({
            name: data.name || 'Unknown',
            phone: data.phone || session.from,
            serviceType: data.serviceType || 'General',
            location: data.location || 'Unknown',
            urgency: data.urgency
          }),
          startTime: tomorrow,
          endTime: new Date(tomorrow.getTime() + 60 * 60 * 1000),
          attendeeName: data.name || 'Unknown',
          attendeePhone: data.phone || session.from,
          location: data.location || 'TBD',
          serviceType: data.serviceType || 'General'
        });

        if (appointment) {
          // Send SMS confirmation
          await twilioService.sendSMS(
            data.phone || session.from,
            twilioService.generateConfirmationMessage({
              name: data.name || 'Valued Customer',
              serviceType: data.serviceType || 'Service',
              date: tomorrow,
              location: data.location || 'your location',
              businessName: process.env.BUSINESS_NAME || 'AnswerAI'
            })
          );
          
          context.stage = 'confirmation';
          return `Perfect! I've booked you for ${tomorrow.toLocaleDateString()} at 10 AM. You'll receive a text confirmation at ${data.phone}. Is there anything else I can help with?`;
        }
      }
      
      context.stage = 'confirmation';
      return `I've noted your request for ${data.serviceType}. Our team will call you within 24 hours to confirm your appointment. You'll receive a text confirmation shortly. Is there anything else?`;

    case 'confirmation':
      context.stage = 'complete';
      return `Thank you for calling! We appreciate your business and look forward to serving you. Have a great day!`;

    default:
      return `Thank you for calling. Goodbye!`;
  }
}

// Call status callback
router.post('/status', (req, res) => {
  const { CallSid, CallStatus } = req.body;
  logger.info('Call status update', { CallSid, CallStatus });
  
  if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'busy') {
    // Clean up session
    sessions.delete(CallSid);
    contexts.delete(CallSid);
  }
  
  res.sendStatus(200);
});

// Google OAuth callback
router.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  
  if (!code || typeof code !== 'string') {
    res.status(400).send('Authorization code required');
    return;
  }
  
  try {
    if (!calendarService) {
      res.status(503).send('Calendar service not available');
      return;
    }
    const tokens = await calendarService.getTokenFromCode(code);
    calendarService.setCredentials(tokens.access_token, tokens.refresh_token || undefined);
    
    logger.info('Google Calendar authenticated successfully');
    res.send('Authentication successful! You can close this window.');
  } catch (error) {
    logger.error('Failed to authenticate with Google', error);
    res.status(500).send('Authentication failed');
  }
});

// Get auth URL for Google Calendar setup
router.get('/auth/url', (req, res) => {
  if (!calendarService) {
    res.status(503).json({ error: 'Calendar service not available' });
    return;
  }
  const authUrl = calendarService.getAuthUrl();
  res.json({ authUrl });
});

export default router;
