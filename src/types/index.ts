export interface CallSession {
  callSid: string;
  from: string;
  to: string;
  status: 'initiated' | 'in-progress' | 'completed' | 'failed';
  startTime: Date;
  collectedData: CollectedData;
  openaiSessionId?: string;
}

export interface CollectedData {
  serviceType?: string;
  location?: string;
  zipCode?: string;
  urgency?: 'low' | 'medium' | 'high' | 'emergency';
  name?: string;
  phone?: string;
  preferredDate?: string;
  preferredTime?: string;
}

export interface Appointment {
  id?: string;
  summary: string;
  description: string;
  startTime: Date;
  endTime: Date;
  attendeeName: string;
  attendeePhone: string;
  location: string;
  serviceType: string;
}

export interface TwilioWebhookBody {
  CallSid: string;
  From: string;
  To: string;
  CallStatus: string;
  SpeechResult?: string;
  Digits?: string;
}

export interface OpenAIRealtimeMessage {
  type: string;
  event_id?: string;
  [key: string]: any;
}

export interface ConversationContext {
  stage: 'greeting' | 'service' | 'location' | 'urgency' | 'contact' | 'scheduling' | 'confirmation' | 'complete';
  attempts: number;
  lastMessage?: string;
}
