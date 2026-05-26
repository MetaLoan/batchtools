import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { nanoid } from 'nanoid';
import { request } from 'undici';
import { saveUpload } from './upload-service.js';

export interface CropParams {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SegmentInput {
  url: string;
  start: number;
  duration: number;
  crop?: CropParams;
}

export interface RenderParams {
  width: number;
  height: number;
  muteOriginal?: boolean;
  audioUrl?: string;
  segments: SegmentInput[];
}

export async function renderVideo(
  params: RenderParams,
  userId: string,
  log: { info: (m: string) => void; debug: (m: string) => void; warn: (m: string, err?: any) => void; error: (m: string, err?: any) => void }
): Promise<string> {
  const {
    width,
    height,
    muteOriginal = false,
    audioUrl,
    segments,
  } = params;

  const tempDir = os.tmpdir();
  const sessionId = nanoid();
  const localFilesToCleanup: string[] = [];

  try {
    log.info(`[video-editor] Starting render session ${sessionId}`);

    // 1. 下载所有视频素材
    const downloadedSegments: { localPath: string; start: number; duration: number; crop?: CropParams }[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      log.info(`[video-editor] Downloading segment ${i}: ${seg.url}`);
      
      const ext = seg.url.match(/\.(mp4|mov|webm)/i)?.[0] || '.mp4';
      const localPath = path.join(tempDir, `bvp-edit-seg-${sessionId}-${i}${ext}`);
      localFilesToCleanup.push(localPath);

      const res = await request(seg.url, { method: 'GET' });
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error(`Failed to download segment ${i} from URL: HTTP ${res.statusCode}`);
      }
      const buf = Buffer.from(await res.body.arrayBuffer());
      fs.writeFileSync(localPath, buf);

      downloadedSegments.push({
        localPath,
        start: seg.start,
        duration: seg.duration,
        crop: seg.crop,
      });
    }

    // 下载背景音 (如有)
    let localAudioPath: string | null = null;
    if (audioUrl) {
      log.info(`[video-editor] Downloading audio: ${audioUrl}`);
      const ext = audioUrl.match(/\.(mp3|wav|m4a|aac)/i)?.[0] || '.mp3';
      localAudioPath = path.join(tempDir, `bvp-edit-audio-${sessionId}${ext}`);
      localFilesToCleanup.push(localAudioPath);

      const res = await request(audioUrl, { method: 'GET' });
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error(`Failed to download audio from URL: HTTP ${res.statusCode}`);
      }
      const buf = Buffer.from(await res.body.arrayBuffer());
      fs.writeFileSync(localAudioPath, buf);
    }

    // 2. 预处理每个片段 (格式、帧率、画幅调整与裁剪对齐)
    const preppedPaths: string[] = [];
    for (let i = 0; i < downloadedSegments.length; i++) {
      const seg = downloadedSegments[i];
      const preppedPath = path.join(tempDir, `bvp-edit-prepped-${sessionId}-${i}.mp4`);
      localFilesToCleanup.push(preppedPath);

      log.info(`[video-editor] Preprocessing segment ${i}: ${seg.localPath}`);

      // 检测视频是否包含音频流
      const hasAudioCmd = `ffprobe -v error -select_streams a -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${seg.localPath}"`;
      const hasAudio = execSync(hasAudioCmd, { encoding: 'utf8' }).trim() !== '';

      // 组装视频画面滤镜 (Scale + Crop 自适应铺满目标画布，不产生黑边)
      let filterParts: string[] = [];
      if (seg.crop) {
        // 用户指定了裁剪框：直接把该区域内容裁剪出来，然后强行缩放到画布宽高
        filterParts.push(`crop=${seg.crop.w}:${seg.crop.h}:${seg.crop.x}:${seg.crop.y}`);
        filterParts.push(`scale=${width}:${height}`);
      } else {
        // 用户未指定裁剪框：自动执行“铺满裁剪(Crop-to-fill)”逻辑，确保画面占满画布不留黑边
        // 先等比例缩放到宽度或高度至少一个先撑满，然后 crop 掉溢出的部分
        filterParts.push(`scale=w='if(gte(iw/ih,${width}/${height}),-1,${width})':h='if(gte(iw/ih,${width}/${height}),${height},-1)'`);
        filterParts.push(`crop=${width}:${height}`);
      }
      const videoFilter = filterParts.join(',');

      // 构造 FFmpeg 命令
      // 如果无声，我们需要多加一个 anullsrc 虚拟音轨，防止 concat 时音轨不匹配导致失败
      let trimCmd = '';
      if (hasAudio) {
        trimCmd = `ffmpeg -y -ss ${seg.start} -t ${seg.duration} -i "${seg.localPath}" -vf "${videoFilter}" -r 30 -c:v libx264 -preset superfast -crf 23 -c:a aac -ar 44100 -ac 2 "${preppedPath}"`;
      } else {
        trimCmd = `ffmpeg -y -ss ${seg.start} -t ${seg.duration} -i "${seg.localPath}" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -vf "${videoFilter}" -r 30 -c:v libx264 -preset superfast -crf 23 -c:a aac -shortest "${preppedPath}"`;
      }

      log.debug(`[video-editor] Prep command for segment ${i}: ${trimCmd}`);
      execSync(trimCmd, { stdio: 'ignore' });
      preppedPaths.push(preppedPath);
    }

    // 3. 将预处理好的视频片段拼合 (Concat)
    const concatListFile = path.join(tempDir, `bvp-edit-list-${sessionId}.txt`);
    localFilesToCleanup.push(concatListFile);

    const listContent = preppedPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(concatListFile, listContent);

    const mergedPath = path.join(tempDir, `bvp-edit-merged-${sessionId}.mp4`);
    localFilesToCleanup.push(mergedPath);

    log.info(`[video-editor] Merging segments`);
    const mergeCmd = `ffmpeg -y -f concat -safe 0 -i "${concatListFile}" -c copy "${mergedPath}"`;
    execSync(mergeCmd, { stdio: 'ignore' });

    // 4. 音频混流与配音叠加
    let finalPath = mergedPath;
    if (localAudioPath) {
      const audioOverlayPath = path.join(tempDir, `bvp-edit-final-${sessionId}.mp4`);
      localFilesToCleanup.push(audioOverlayPath);

      let mixCmd = '';
      if (muteOriginal) {
        // 完全使用配音覆盖原视频音频（在视频结尾处做 shortest 截断）
        mixCmd = `ffmpeg -y -i "${mergedPath}" -i "${localAudioPath}" -map 0:v -map 1:a -c:v copy -c:a aac -shortest "${audioOverlayPath}"`;
      } else {
        // 音频混合 (amix)，保持时长与视频原轨一致
        mixCmd = `ffmpeg -y -i "${mergedPath}" -i "${localAudioPath}" -filter_complex "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2[a]" -map 0:v -map "[a]" -c:v copy -c:a aac "${audioOverlayPath}"`;
      }

      log.info(`[video-editor] Overlaying background audio`);
      execSync(mixCmd, { stdio: 'ignore' });
      finalPath = audioOverlayPath;
    }

    // 5. 上传最终合成的视频
    log.info(`[video-editor] Uploading output video`);
    const finalBuf = fs.readFileSync(finalPath);
    const uploadRes = await saveUpload({
      userId,
      filename: `rendered_${nanoid()}.mp4`,
      mime: 'video/mp4',
      data: finalBuf,
    });

    log.info(`[video-editor] Render session ${sessionId} completed successfully. URL: ${uploadRes.publicUrl}`);
    return uploadRes.publicUrl;

  } catch (err: any) {
    log.error(`[video-editor] Render session ${sessionId} failed:`, err);
    throw err;
  } finally {
    // 6. 清理所有本地产生的临时文件
    log.info(`[video-editor] Cleaning up temporary files for ${sessionId}`);
    for (const p of localFilesToCleanup) {
      try {
        if (fs.existsSync(p)) {
          fs.unlinkSync(p);
        }
      } catch (cleanupErr) {
        log.warn(`[video-editor] Failed to delete temp file ${p}:`, cleanupErr);
      }
    }
  }
}
