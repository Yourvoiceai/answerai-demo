import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { logger } from '../utils/logger';
import { Appointment } from '../types';

export class CalendarService {
  private oauth2Client: OAuth2Client;
  private calendar: calendar_v3.Calendar;
  private calendarId: string;

  constructor() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/callback';
    this.calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

    if (!clientId || !clientSecret) {
      throw new Error('Google OAuth credentials are required');
    }

    this.oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
    this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
  }

  setCredentials(accessToken: string, refreshToken?: string): void {
    this.oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });
  }

  getAuthUrl(): string {
    const scopes = ['https://www.googleapis.com/auth/calendar'];
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
  }

  async getTokenFromCode(code: string): Promise<{ access_token: string; refresh_token?: string | null }> {
    const { tokens } = await this.oauth2Client.getToken(code);
    if (!tokens.access_token) {
      throw new Error('No access token received');
    }
    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token
    };
  }

  async createAppointment(appointment: Appointment): Promise<string | null> {
    try {
      const event: calendar_v3.Schema$Event = {
        summary: appointment.summary,
        description: appointment.description,
        start: {
          dateTime: appointment.startTime.toISOString(),
          timeZone: 'America/Los_Angeles'
        },
        end: {
          dateTime: appointment.endTime.toISOString(),
          timeZone: 'America/Los_Angeles'
        },
        attendees: [
          {
            displayName: appointment.attendeeName,
            comment: `Phone: ${appointment.attendeePhone}`
          }
        ],
        location: appointment.location,
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'sms', minutes: 60 },
            { method: 'popup', minutes: 30 }
          ]
        }
      };

      const response = await this.calendar.events.insert({
        calendarId: this.calendarId,
        requestBody: event
      });

      logger.info('Appointment created', { eventId: response.data.id });
      return response.data.id || null;
    } catch (error) {
      logger.error('Failed to create appointment', error);
      return null;
    }
  }

  async checkAvailability(date: Date, durationMinutes: number = 60): Promise<boolean> {
    try {
      const endTime = new Date(date.getTime() + durationMinutes * 60000);
      
      const response = await this.calendar.freebusy.query({
        requestBody: {
          timeMin: date.toISOString(),
          timeMax: endTime.toISOString(),
          items: [{ id: this.calendarId }]
        }
      });

      const busySlots = response.data.calendars?.[this.calendarId]?.busy || [];
      return busySlots.length === 0;
    } catch (error) {
      logger.error('Failed to check availability', error);
      return true; // Assume available on error
    }
  }

  async findNextAvailableSlot(startDate: Date, durationMinutes: number = 60): Promise<Date | null> {
    const businessHours = { start: 8, end: 17 }; // 8 AM to 5 PM
    let checkDate = new Date(startDate);
    
    // Try next 14 days
    for (let day = 0; day < 14; day++) {
      for (let hour = businessHours.start; hour < businessHours.end; hour++) {
        const slot = new Date(checkDate);
        slot.setHours(hour, 0, 0, 0);
        
        if (slot > startDate) {
          const isAvailable = await this.checkAvailability(slot, durationMinutes);
          if (isAvailable) {
            return slot;
          }
        }
      }
      checkDate.setDate(checkDate.getDate() + 1);
    }
    
    return null;
  }

  generateAppointmentSummary(serviceType: string, urgency?: string): string {
    const prefix = urgency === 'emergency' ? 'URGENT:' : 'Service:';
    return `${prefix} ${serviceType} - AnswerAI Demo`;
  }

  generateAppointmentDescription(data: {
    name: string;
    phone: string;
    serviceType: string;
    location: string;
    urgency?: string;
  }): string {
    return `Customer: ${data.name}
Phone: ${data.phone}
Service: ${data.serviceType}
Location: ${data.location}
Urgency: ${data.urgency || 'Standard'}

Booked via AnswerAI Voice Assistant
`;
  }
}
