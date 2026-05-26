import '../server/src/config.js';
import { generateScripts } from '../server/src/services/llm-service.js';

async function testGrokGenerator() {
  console.log('=== Start testing Grok Persona Script Generator ===');
  
  const testParams = {
    persona: '一名身穿红色古装长裙的少女刺客，在竹林中飞檐走壁，手持短刃，眼神凌厉',
    refImageUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3',
    duration: 10,
    count: 2,
  };

  console.log('Sending request to Grok with params:', testParams);
  
  try {
    const start = Date.now();
    const scripts = await generateScripts(testParams);
    const duration = ((Date.now() - start) / 1000).toFixed(2);
    
    console.log(`\nSuccess! LLM request finished in ${duration}s.`);
    console.log('-----------------------------');
    console.log(JSON.stringify(scripts, null, 2));
    console.log('-----------------------------');
    
    // Assert structure
    if (!Array.isArray(scripts)) {
      throw new Error('Output is not an array!');
    }
    
    if (scripts.length !== testParams.count) {
      console.warn(`Warning: expected ${testParams.count} scripts, got ${scripts.length}`);
    }
    
    for (const [idx, item] of scripts.entries()) {
      if (!item.title || !item.prompt || typeof item.duration !== 'number') {
        throw new Error(`Script at index ${idx} is missing required fields (title, prompt, duration) or duration is not a number.`);
      }
      console.log(`Checked script ${idx + 1}: ${item.title} (${item.duration}s) - OK`);
    }
    
    console.log('\n=== All tests passed successfully! ===');
  } catch (err: any) {
    console.error('\n=== Test failed! ===');
    console.error(err);
    process.exit(1);
  }
}

testGrokGenerator();
