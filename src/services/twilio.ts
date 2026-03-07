import twilio from 'twilio';
import { logger } from '../utils/logger';

export class TwilioService {
  private client: twilio.Twilio;
  private fromNumber: string;

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER || '';

    if (!accountSid || !authToken) {
      throw new Error('Twilio credentials are required');
    }

    this.client = twilio(accountSid, authToken);
  }

  async sendSMS(to: string, message: string): Promise<boolean> {
    try {
      if (!process.env.ENABLE_SMS_CONFIRMATION) {
        logger.info('SMS confirmation disabled');
        return true;
      }

      const response = await this.client.messages.create({
        body: message,
        from: this.fromNumber,
        to: to
      });

      logger.info('SMS sent successfully', { sid: response.sid });
      return true;
    } catch (error) {
      logger.error('Failed to send SMS', error);
      return false;
    }
  }

  generateConfirmationMessage(data: {
    name: string;
    serviceType: string;
    date: Date;
    location: string;
    businessName: string;
  }): string {
    const dateStr = data.date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
    const timeStr = data.date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });

    return `Hi ${data.name}, your ${data.serviceType} appointment with ${data.businessName} is confirmed for ${dateStr} at ${timeStr}. We'll see you at ${data.location}. Reply STOP to opt out.`;
  }

  generateEscalationMessage(data: {
    name: string;
    phone: string;
    serviceType?: string;
    location?: string;
    urgency?: string;
  }): string {
    return `ESCALATION ALERT: Call from ${data.name} (${data.phone}) requires immediate attention. Service: ${data.serviceType || 'Unknown'}, Location: ${data.location || 'Unknown'}, Urgency: ${data.urgency || 'Unknown'}`;
  }

  async transferCall(callSid: string, toNumber: string): Promise<boolean> {
    try {
      await this.client.calls(callSid).update({
        twiml: `
          <Response>
            <Say>Please hold while I transfer you to a representative.</Say>
            <Dial>${toNumber}</Dial>
          </Response>
        `
      });
      return true;
    } catch (error) {
      logger.error('Failed to transfer call', error);
      return false;
    }
  }

  generateVoiceResponse(message: string, gatherSpeech: boolean = true): string {
    const businessName = process.env.BUSINESS_NAME || 'our company';
    
    if (gatherSpeech) {
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${message}</Say>
  <Gather input="speech" timeout="5" speechTimeout="auto" action="/webhook/voice" method="POST">
    <Say voice="Polly.Joanna">I'm listening. Go ahead.</Say>
  </Gather>
  <Say voice="Polly.Joanna">I didn't hear anything. Let me transfer you to someone.</Say>
  <Dial>${process.env.ESCALATION_PHONE || ''}</Dial>
</Response>`;
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${message}</Say>
  <Hangup/>
</Response>`;
  }

  generateStreamResponse(streamUrl: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="customParameter" value="customValue"/>
    </Stream>
  </Connect>
</Response>`;
  }
}
