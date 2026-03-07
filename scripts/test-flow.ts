import fetch from 'node-fetch';
import { logger } from '../src/utils/logger';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

async function runTest(name: string, testFn: () => Promise<void>): Promise<TestResult> {
  const start = Date.now();
  try {
    await testFn();
    return { name, passed: true, duration: Date.now() - start };
  } catch (error) {
    return { 
      name, 
      passed: false, 
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - start
    };
  }
}

async function testHealthEndpoint(): Promise<void> {
  const response = await fetch(`${BASE_URL}/health`);
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`);
  }
  
  const data = await response.json() as { status: string };
  if (data.status !== 'ok') {
    throw new Error(`Unexpected health status: ${data.status}`);
  }
}

async function testRootEndpoint(): Promise<void> {
  const response = await fetch(`${BASE_URL}/`);
  if (!response.ok) {
    throw new Error(`Root endpoint failed: ${response.status}`);
  }
  
  const data = await response.json() as { name: string };
  if (!data.name) {
    throw new Error('Missing name in root response');
  }
}

async function testVoiceWebhook(): Promise<void> {
  const callSid = `TEST${Date.now()}`;
  const response = await fetch(`${BASE_URL}/webhook/voice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      CallSid: callSid,
      From: '+15551234567',
      To: '+15559876543',
      CallStatus: 'in-progress'
    })
  });
  
  if (!response.ok) {
    throw new Error(`Voice webhook failed: ${response.status}`);
  }
  
  const twiml = await response.text();
  if (!twiml.includes('<?xml')) {
    throw new Error('Invalid TwiML response');
  }
  if (!twiml.includes('<Say')) {
    throw new Error('Missing Say element in TwiML');
  }
  if (!twiml.includes('<Gather')) {
    throw new Error('Missing Gather element in TwiML');
  }
}

async function testConversationFlow(): Promise<void> {
  const callSid = `TEST${Date.now()}`;
  
  // Step 1: Initial call (greeting)
  const response1 = await fetch(`${BASE_URL}/webhook/voice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      CallSid: callSid,
      From: '+15551234567',
      To: '+15559876543',
      CallStatus: 'in-progress'
    })
  });
  
  const twiml1 = await response1.text();
  if (!twiml1.toLowerCase().includes('thanks for calling')) {
    throw new Error('Missing greeting in initial response');
  }
  
  // Step 2: Provide service type
  const response2 = await fetch(`${BASE_URL}/webhook/voice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      CallSid: callSid,
      From: '+15551234567',
      To: '+15559876543',
      CallStatus: 'in-progress',
      SpeechResult: 'I need electrical help with my outlets'
    })
  });
  
  const twiml2 = await response2.text();
  if (!twiml2.toLowerCase().includes('address')) {
    throw new Error('Should ask for address after service type');
  }
  
  // Step 3: Provide location
  const response3 = await fetch(`${BASE_URL}/webhook/voice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      CallSid: callSid,
      From: '+15551234567',
      To: '+15559876543',
      CallStatus: 'in-progress',
      SpeechResult: '123 Main Street, Irvine California 92618'
    })
  });
  
  const twiml3 = await response3.text();
  if (!twiml3.toLowerCase().includes('emergency')) {
    throw new Error('Should ask about urgency after location');
  }
  
  // Step 4: Provide urgency
  const response4 = await fetch(`${BASE_URL}/webhook/voice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      CallSid: callSid,
      From: '+15551234567',
      To: '+15559876543',
      CallStatus: 'in-progress',
      SpeechResult: 'No it can wait for a scheduled appointment'
    })
  });
  
  const twiml4 = await response4.text();
  if (!twiml4.toLowerCase().includes('name')) {
    throw new Error('Should ask for contact info after urgency');
  }
}

async function testEscalation(): Promise<void> {
  const callSid = `TEST${Date.now()}`;
  
  // Initial call
  await fetch(`${BASE_URL}/webhook/voice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      CallSid: callSid,
      From: '+15551234567',
      To: '+15559876543',
      CallStatus: 'in-progress'
    })
  });
  
  // Say emergency keyword
  const response = await fetch(`${BASE_URL}/webhook/voice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      CallSid: callSid,
      From: '+15551234567',
      To: '+15559876543',
      CallStatus: 'in-progress',
      SpeechResult: 'This is an emergency I need to speak to someone now'
    })
  });
  
  const twiml = await response.text();
  if (!twiml.includes('<Dial')) {
    throw new Error('Should transfer call on escalation');
  }
}

async function testStatusCallback(): Promise<void> {
  const response = await fetch(`${BASE_URL}/webhook/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      CallSid: `TEST${Date.now()}`,
      CallStatus: 'completed'
    })
  });
  
  if (!response.ok) {
    throw new Error(`Status callback failed: ${response.status}`);
  }
}

async function main(): Promise<void> {
  logger.info('Starting AnswerAI Voice Demo tests...');
  logger.info(`Base URL: ${BASE_URL}`);
  
  const tests = [
    runTest('Health Endpoint', testHealthEndpoint),
    runTest('Root Endpoint', testRootEndpoint),
    runTest('Voice Webhook (Initial)', testVoiceWebhook),
    runTest('Conversation Flow', testConversationFlow),
    runTest('Escalation Handling', testEscalation),
    runTest('Status Callback', testStatusCallback)
  ];
  
  const results = await Promise.all(tests);
  
  console.log('\n' + '='.repeat(60));
  console.log('TEST RESULTS');
  console.log('='.repeat(60));
  
  let passed = 0;
  let failed = 0;
  
  for (const result of results) {
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    const duration = `${result.duration}ms`;
    
    console.log(`${status} | ${result.name} (${duration})`);
    
    if (!result.passed) {
      console.log(`      Error: ${result.error}`);
      failed++;
    } else {
      passed++;
    }
  }
  
  console.log('='.repeat(60));
  console.log(`Total: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    logger.error('Test suite failed', error);
    process.exit(1);
  });
}

export { runTest };
