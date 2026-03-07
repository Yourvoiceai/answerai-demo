# AnswerAI Voice Demo - Setup Guide

## Prerequisites

- Node.js 18+ installed
- A Twilio account with a phone number
- An OpenAI API key with access to Realtime API
- A Google Cloud project with Calendar API enabled
- Ngrok (for local development)

## Step-by-Step Setup

### 1. Install Dependencies

```bash
cd answerai-demo
npm install
```

### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your actual credentials:

#### Twilio Setup
1. Go to https://console.twilio.com/
2. Copy your Account SID and Auth Token
3. Buy a phone number or use an existing one
4. Add these to `.env`:
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your_auth_token_here
   TWILIO_PHONE_NUMBER=+1234567890
   ```

#### OpenAI Setup
1. Go to https://platform.openai.com/api-keys
2. Create a new API key
3. Add to `.env`:
   ```
   OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

#### Google Calendar Setup
1. Go to https://console.cloud.google.com/
2. Create a new project (or select existing)
3. Enable the Google Calendar API:
   - APIs & Services → Library → Search "Calendar" → Enable
4. Create OAuth 2.0 credentials:
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: "Desktop app"
   - Name: "AnswerAI Demo"
   - Download the JSON credentials file
5. Add to `.env`:
   ```
   GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your_client_secret
   ```

### 3. Start Ngrok (for local development)

```bash
# Install ngrok if needed
brew install ngrok

# Start ngrok on port 3000
ngrok http 3000
```

Copy the HTTPS URL (e.g., `https://abc123-def.ngrok.io`)

Update `.env`:
```
PUBLIC_URL=https://abc123-def.ngrok.io
```

### 4. Configure Twilio Webhook

1. Go to https://console.twilio.com/
2. Phone Numbers → Manage → Active Numbers
3. Click your phone number
4. Under "Voice & Fax":
   - A CALL COMES IN: Webhook
   - URL: `https://your-ngrok-url.ngrok.io/webhook/voice`
   - HTTP Method: POST
5. Save

### 5. Authenticate Google Calendar

1. Start the server:
   ```bash
   npm run dev
   ```

2. Open browser to:
   ```
   http://localhost:3000/webhook/auth/url
   ```

3. Click the auth URL and sign in with your Google account
4. Grant Calendar permissions
5. Copy the authorization code from the callback URL

6. Exchange the code for tokens (run this in a new terminal):
   ```bash
   curl "http://localhost:3000/webhook/auth/callback?code=YOUR_AUTH_CODE"
   ```

7. Note the access_token and refresh_token from the response
8. Add to `.env`:
   ```
   GOOGLE_ACCESS_TOKEN=ya29.xxx...
   GOOGLE_REFRESH_TOKEN=1//xxx...
   ```

### 6. Test the Setup

```bash
# Run the test suite
npm run test
```

You should see all tests passing:
```
✅ PASS | Health Endpoint
✅ PASS | Root Endpoint
✅ PASS | Voice Webhook (Initial)
✅ PASS | Conversation Flow
✅ PASS | Escalation Handling
✅ PASS | Status Callback
```

### 7. Make a Test Call

1. Call your Twilio phone number
2. The AI assistant should answer
3. Try the conversation flow:
   - "I need electrical help"
   - "123 Main Street, Irvine 92618"
   - "It's not urgent"
   - "My name is John, my number is 555-123-4567"
4. You should receive an SMS confirmation

## Troubleshooting

### "Invalid TwiML" errors
- Check that your webhook URL is correct in Twilio
- Ensure ngrok is running and the URL matches

### Google Calendar auth fails
- Make sure you enabled the Calendar API
- Verify your OAuth credentials are for "Desktop app"
- Check that redirect URI matches exactly

### OpenAI errors
- Verify your API key has access to Realtime API
- Check that billing is enabled on your OpenAI account

### SMS not sending
- Verify `ENABLE_SMS_CONFIRMATION=true` in `.env`
- Check Twilio logs for delivery errors
- Ensure your Twilio number is SMS-capable

## Production Deployment

For production deployment:

1. Use a proper hosting service (Railway, Render, Heroku, etc.)
2. Set up a persistent database (PostgreSQL, MongoDB)
3. Use Redis for session storage
4. Set up proper error monitoring (Sentry)
5. Configure production Twilio and Google credentials
6. Use a proper domain instead of ngrok

## Support

For issues or questions, check:
- Twilio Docs: https://www.twilio.com/docs
- OpenAI Realtime API: https://platform.openai.com/docs/guides/realtime
- Google Calendar API: https://developers.google.com/calendar
