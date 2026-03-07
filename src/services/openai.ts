import WebSocket from 'ws';
import { logger } from '../utils/logger';
import { CallSession, OpenAIRealtimeMessage, ConversationContext, CollectedData } from '../types';

export class OpenAIService {
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || '';
    this.model = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';

    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY is required');
    }
  }

  async createRealtimeSession(): Promise<WebSocket> {
    const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=' + this.model, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });

    return new Promise((resolve, reject) => {
      ws.on('open', () => {
        logger.info('OpenAI Realtime WebSocket connected');
        resolve(ws);
      });

      ws.on('error', (error) => {
        logger.error('OpenAI Realtime WebSocket error', error);
        reject(error);
      });
    });
  }

  async setupSessionConfig(ws: WebSocket, businessName: string): Promise<void> {
    const sessionConfig: OpenAIRealtimeMessage = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: this.getSystemInstructions(businessName),
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
  }

  private getSystemInstructions(businessName: string): string {
    return `You are an AI receptionist for ${businessName}, a service company serving residential and commercial customers.

Your job is to handle incoming calls professionally and collect the following information:
1. What service they need (electrical, HVAC, plumbing, or general)
2. Their location/address and zip code
3. Urgency level (routine maintenance, minor issue, urgent, or emergency)
4. Their name and callback phone number
5. Preferred date and time for service

CONVERSATION FLOW:
- Start with: "Thanks for calling ${businessName}. I'm the AI assistant. How can I help you today?"
- Listen to their service need, then ask for location
- Ask for zip code to confirm service area
- Ask about urgency: "Is this an emergency, or can it wait for a scheduled appointment?"
- Collect their name and confirm phone number
- Offer scheduling options within the next 2-3 business days
- Confirm all details before ending

IMPORTANT RULES:
- If they say "emergency", "urgent", "speak to someone", "human", or "representative", immediately offer to transfer
- Be friendly, professional, and efficient
- Don't rush the caller, but keep the conversation focused
- Confirm details by repeating them back
- If you can't understand, politely ask them to repeat

ESCALATION TRIGGERS:
- Say "emergency" or "urgent"
- Say "speak to someone" or "human" or "representative"
- Sound distressed or mention safety concerns

When escalating, say: "I'll transfer you to someone right away. Please hold."`;
  }

  sendAudio(ws: WebSocket, audioBase64: string): void {
    const message: OpenAIRealtimeMessage = {
      type: 'input_audio_buffer.append',
      audio: audioBase64
    };
    ws.send(JSON.stringify(message));
  }

  commitAudio(ws: WebSocket): void {
    const message: OpenAIRealtimeMessage = {
      type: 'input_audio_buffer.commit'
    };
    ws.send(JSON.stringify(message));
  }

  createResponse(ws: WebSocket): void {
    const message: OpenAIRealtimeMessage = {
      type: 'response.create'
    };
    ws.send(JSON.stringify(message));
  }

  parseResponse(data: WebSocket.Data): OpenAIRealtimeMessage | null {
    try {
      return JSON.parse(data.toString());
    } catch (error) {
      logger.error('Failed to parse OpenAI response', error);
      return null;
    }
  }

  extractTextFromResponse(message: OpenAIRealtimeMessage): string | null {
    if (message.type === 'response.text.delta' && message.delta) {
      return message.delta;
    }
    if (message.type === 'response.text.done' && message.text) {
      return message.text;
    }
    return null;
  }

  extractAudioFromResponse(message: OpenAIRealtimeMessage): string | null {
    if (message.type === 'response.audio.delta' && message.delta) {
      return message.delta;
    }
    return null;
  }

  shouldEscalate(text: string): boolean {
    const escalationKeywords = [
      'emergency', 'urgent', 'speak to someone', 'human', 'representative',
      'operator', 'supervisor', 'manager', 'fire', 'flood', 'gas leak',
      'electrical hazard', 'dangerous', 'unsafe'
    ];
    
    const lowerText = text.toLowerCase();
    return escalationKeywords.some(keyword => lowerText.includes(keyword));
  }

  extractCollectedData(text: string): Partial<CollectedData> {
    const data: Partial<CollectedData> = {};
    const lowerText = text.toLowerCase();

    // Extract service type
    if (lowerText.includes('electrical') || lowerText.includes('electric')) {
      data.serviceType = 'Electrical';
    } else if (lowerText.includes('hvac') || lowerText.includes('heating') || lowerText.includes('air conditioning') || lowerText.includes('ac ')) {
      data.serviceType = 'HVAC';
    } else if (lowerText.includes('plumbing') || lowerText.includes('plumber') || lowerText.includes('water') || lowerText.includes('leak') || lowerText.includes('drain')) {
      data.serviceType = 'Plumbing';
    } else if (lowerText.includes('repair') || lowerText.includes('fix') || lowerText.includes('install')) {
      data.serviceType = 'General Repair';
    }

    // Extract urgency
    if (lowerText.includes('emergency') || lowerText.includes('urgent') || lowerText.includes('asap')) {
      data.urgency = 'emergency';
    } else if (lowerText.includes('soon') || lowerText.includes('this week')) {
      data.urgency = 'high';
    } else if (lowerText.includes('routine') || lowerText.includes('maintenance') || lowerText.includes('check')) {
      data.urgency = 'low';
    }

    // Extract zip code (5 digits)
    const zipMatch = text.match(/\b\d{5}\b/);
    if (zipMatch) {
      data.zipCode = zipMatch[0];
    }

    return data;
  }
}
