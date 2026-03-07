const WebSocket = require('ws');

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('OPENAI_API_KEY not set');
  process.exit(1);
}

const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime', {
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'OpenAI-Beta': 'realtime=v1'
  }
});

ws.on('open', () => {
  console.log('Connected to OpenAI Realtime');
  
  // Update session
  ws.send(JSON.stringify({
    type: 'session.update',
    session: {
      modalities: ['text', 'audio'],
      instructions: 'You are a helpful assistant. Greet the user and ask how you can help.',
      voice: 'alloy',
      input_audio_format: 'g711_ulaw',
      output_audio_format: 'g711_ulaw'
    }
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('Received:', msg.type, msg.type === 'response.audio.delta' ? '(audio data)' : '');
  
  if (msg.type === 'session.updated') {
    console.log('Session updated, creating conversation item...');
    
    // Create a conversation item
    ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Hello' }]
      }
    }));
  }
  
  if (msg.type === 'conversation.item.created') {
    console.log('Conversation item created, triggering response...');
    ws.send(JSON.stringify({
      type: 'response.create',
      response: {
        modalities: ['text', 'audio']
      }
    }));
  }
  
  if (msg.type === 'response.audio.delta' || msg.type === 'response.output_audio.delta') {
    console.log('Got audio delta!');
  }
  
  if (msg.type === 'response.done') {
    console.log('Response done:', JSON.stringify(msg, null, 2));
    // Wait a bit for any trailing audio deltas
    setTimeout(() => {
      ws.close();
    }, 2000);
  }
  
  if (msg.type === 'error') {
    console.error('Error:', msg.error);
    ws.close();
  }
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err);
});

ws.on('close', () => {
  console.log('Connection closed');
  process.exit(0);
});
