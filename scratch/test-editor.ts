import { renderVideo } from '../server/src/services/editor-service.js';

async function runTest() {
  const testParams = {
    width: 720,
    height: 1280, // 画幅设为 720x1280 (9:16 纵向)
    muteOriginal: false,
    audioUrl: 'https://www.w3schools.com/html/horse.mp3', // 测试音轨
    segments: [
      {
        url: 'https://cdn.sprize.ai/proxy/15781/019e5e8e-f2ba-7a43-ae96-5ecb5b4404e7_0.mp4',
        start: 0,
        duration: 3.5,
        crop: {
          x: 200,
          y: 400,
          w: 600,
          // 裁剪出 600x600 的正方形画面，测试自动缩放并填黑边效果
          h: 600,
        }
      },
      {
        url: 'https://cdn.sprize.ai/proxy/15781/019e5e8e-f2ba-7a43-ae96-5ecb5b4404e7_0.mp4',
        start: 5.0,
        duration: 4.5
        // 不进行画面 crop，测试直接缩放效果
      }
    ]
  };

  const logger = {
    info: (m: string) => console.log(`[INFO] ${m}`),
    debug: (m: string) => console.log(`[DEBUG] ${m}`),
    warn: (m: string, err?: any) => console.warn(`[WARN] ${m}`, err || ''),
    error: (m: string, err?: any) => console.error(`[ERROR] ${m}`, err || ''),
  };

  console.log('--- Triggering renderVideo ---');
  try {
    const resultUrl = await renderVideo(testParams, 'test-editor-user', logger);
    console.log('\n=============================================');
    console.log(`渲染成功！生成视频 URL: ${resultUrl}`);
    console.log('=============================================');
  } catch (err: any) {
    console.error('\n=============================================');
    console.error('渲染失败！错误信息：', err);
    console.error('=============================================');
  }
}

runTest();
