import { dashScopePost } from '../server/src/providers/dashscope/base-client.js';

async function runTest() {
  const testBody = {
    model: 'wan2.7-i2v-2026-04-25',
    input: {
      prompt: 'test prompt',
      media: [
        {
          type: 'first_clip',
          url: 'http://clips.vorwaerts-gmbh.de/VfE_html5.mp4'
        }
      ]
    }
  };

  console.log('Original request body:', JSON.stringify(testBody, null, 2));
  
  const ctx = {
    apiKey: 'test-key',
    endpoint: 'http://localhost:9999/dummy', // connection will fail, which is expected
    accountId: 'test-account',
    requestId: 'test-request',
  };

  try {
    console.log('\n--- Triggering dashScopePost ---');
    await dashScopePost('/services/dummy', testBody, ctx as any);
  } catch (err: any) {
    console.log('\n--- Request finished (Connection error is expected) ---');
  }
}

runTest();
