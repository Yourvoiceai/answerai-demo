# AnswerAI Voice Demo Infrastructure

AI receptionist for trades contractors (electricians, HVAC, plumbing).

## Overview

This is a working voice demo built for validation calls with real contractors. It demonstrates:
- Incoming call handling via Twilio
- Voice conversation using OpenAI Realtime API
- Basic contractor intake (service type, location, urgency, contact info)
- Google Calendar appointment booking
- SMS confirmation to callers

## Tech Stack

- **Telephony:** Twilio
- **Voice AI:** OpenAI Realtime API (GPT-4o realtime)
- **Backend:** Node.js + TypeScript + Express
- **Calendar:** Google Calendar API
- **SMS:** Twilio

## Project Structure

```
answerai-demo/
├── src/
│   ├── index.ts              # Main server entry point
│   ├── routes/
│   │   └── webhook.ts        # Twilio webhook handlers
│   ├── services/
│   │   ├── openai.ts         # OpenAI Realtime API integration
│   │   ├── calendar.ts       # Google Calendar integration
│   │   └── twilio.ts         # Twilio SMS service
│   ├── types/
│   │   └── index.ts          # TypeScript interfaces
│   └── utils/
│       └── logger.ts         # Logging utility
├── scripts/
│   └── test-flow.ts          # End-to-end test script
├── .env.example              # Environment variables template
├── package.json
├── tsconfig.json
└── README.md
```

## Quick Start

### 1. Install Dependencies

```bash
cd answerai-demo
npm install
```

### 2. Configure Environment Variables

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 3. Set Up Ngrok (for local development)

```bash
# Install ngrok if you haven't
brew install ngrok

# Start ngrok on port 3000
ngrok http 3000

# Copy the HTTPS URL (e.g., https://abc123.ngrok.io)
# Update your Twilio webhook URL with: https://abc123.ngrok.io/webhook/voice
```

### 4. Configure Twilio

1. Go to [Twilio Console](https://console.twilio.com/)
2. Buy a phone number or use existing one
3. Configure Voice webhook: `https://your-ngrok-url/webhook/voice`
4. Note your Account SID and Auth Token for `.env`

### 5. Set Up Google Calendar

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable Google Calendar API
4. Create OAuth 2.0 credentials (Desktop application type)
5. Download credentials JSON
6. Run the auth setup script (see below)

### 6. Run the Server

```bash
# Development mode
npm run dev

# Production build
npm run build
npm start
```

### 7. Test the Flow

```bash
npm run test
```

## Environment Variables

See `.env.example` for all required variables.

## Conversation Flow

1. **Greeting:** "Thanks for calling [Business Name]. I'm the AI assistant. How can I help?"
2. **Capture:** Service needed, location/zip code, urgency level, name, phone
3. **Confirm:** "I'll book you for [date/time]. You'll get a text confirmation."
4. **Escalate:** Transfer to human if caller says "emergency" or "speak to someone"

## API Endpoints

- `POST /webhook/voice` - Twilio voice webhook (incoming calls)
- `POST /webhook/status` - Call status callbacks
- `GET /health` - Health check

## Testing

The test script simulates:
1. Incoming call webhook
2. Conversation flow validation
3. Calendar booking verification
4. SMS confirmation check

## Notes for Demo

- This is a **demo** — not production-ready
- Designed for 3-5 validation calls with real contractors
- Uses OpenAI Realtime API for natural voice conversation
- Calendar bookings create 1-hour appointment slots
- SMS confirmations sent immediately after booking

## License

MIT - For demo purposes only.
