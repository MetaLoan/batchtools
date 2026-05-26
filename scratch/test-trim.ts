import { resolveAndTrimExternalVideos } from '../server/src/providers/dashscope/base-client.js';

async function runTest() {
  const testBody = {
    model: 'wan2.7-i2v-2026-04-25',
    input: {
      prompt: 'test prompt',
      media: [
        {
          type: 'first_clip',
          url: 'https://cdn.sprize.ai/proxy/15781/019e5e8e-f2ba-7a43-ae96-5ecb5b4404e7_0.mp4'
        }
      ]
    },
    parameters: {
      duration: 10
    }
  };

  console.log('Original request body:', JSON.stringify(testBody, null, 2));
  
  try {
    console.log('\n--- Triggering resolveAndTrimExternalVideos ---');
    const result = await resolveAndTrimExternalVideos(testBody);
    console.log('\nProcessed request body:', JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.error('Error during trim check:', err);
  }
}

runTest();
