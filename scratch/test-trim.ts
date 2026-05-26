import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { resolveAndTrimExternalVideos } from '../server/src/providers/dashscope/base-client.js';

// 启动本地 http 服务托管 dummy.mp4
const server = http.createServer((req, res) => {
  if (req.url === '/dummy.mp4') {
    const filePath = path.join(import.meta.dirname, 'dummy.mp4');
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': stat.size
    });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(12345, async () => {
  console.log('Local HTTP server started at http://localhost:12345');

  const testBody = {
    model: 'wan2.7-i2v-2026-04-25',
    input: {
      prompt: 'test prompt',
      media: [
        {
          type: 'first_clip',
          url: 'http://localhost:12345/dummy.mp4'
        }
      ]
    },
    parameters: {
      duration: 8
    }
  };

  console.log('Original request body:', JSON.stringify(testBody, null, 2));
  
  try {
    console.log('\n--- Triggering resolveAndTrimExternalVideos ---');
    const result = await resolveAndTrimExternalVideos(testBody);
    console.log('\nProcessed request body:', JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.error('Error during trim check:', err);
  } finally {
    server.close();
  }
});
