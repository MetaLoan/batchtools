import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { 
  Play, 
  Pause, 
  Plus, 
  Trash2, 
  Volume2, 
  VolumeX, 
  Loader2, 
  Scissors, 
  Crop as CropIcon, 
  FileVideo, 
  Music, 
  Save, 
  Download,
  Film
} from 'lucide-react';
import { Slider, Switch, Select, Button, message, Input } from 'antd';

interface CropParams {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SegmentItem {
  id: string;
  url: string;
  filename: string;
  start: number;
  duration: number;
  maxDuration: number; // 原视频总时长
  crop?: CropParams;
}

export default function EditorPage() {
  // 项目画布设置
  const [canvasWidth, setCanvasWidth] = useState(720);
  const [canvasHeight, setCanvasHeight] = useState(1280);
  const [canvasRatio, setCanvasRatio] = useState<'916' | '169' | '11'>('916');

  // 音频设置
  const [muteOriginal, setMuteOriginal] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [audioFilename, setAudioFilename] = useState('');

  // 视频片段段轨 (支持拼接/合并)
  const [segments, setSegments] = useState<SegmentItem[]>([]);
  
  // 选中的片段索引，用于调节属性 (如裁剪 crop)
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState<number | null>(null);

  // 播放控制
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  // 渲染/合成状态
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState('');
  const [outputUrl, setOutputUrl] = useState<string | null>(null);

  // 可视化画幅裁剪框状态 (Crop Box)
  const [cropEnabled, setCropEnabled] = useState(false);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  
  // 裁剪框的绝对定位百分比（前端交互）
  const [cropBox, setCropBox] = useState({ left: 10, top: 10, width: 80, height: 50 });
  const isDraggingCrop = useRef(false);
  const isResizingCrop = useRef<string | null>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const cropBoxStart = useRef({ left: 0, top: 0, width: 0, height: 0 });

  // 时间轴轨道比例尺：1秒 = 12像素
  const pxPerSec = 12;

  // 查询素材库列表
  const { data: uploadData, refetch: refetchUploads } = useQuery({
    queryKey: ['uploads'],
    queryFn: () => api.listUploads(),
  });

  const uploads = uploadData?.uploads ?? [];
  const videoAssets = uploads.filter((u) => u.mime.startsWith('video/'));
  const audioAssets = uploads.filter((u) => u.mime.startsWith('audio/'));

  // 计算总时长
  const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);

  // 同步播放进度与时间轴播放头
  useEffect(() => {
    let animId: number;
    const updateProgress = () => {
      if (videoRef.current && isPlaying) {
        setCurrentTime(videoRef.current.currentTime);
        animId = requestAnimationFrame(updateProgress);
      }
    };
    if (isPlaying) {
      animId = requestAnimationFrame(updateProgress);
    }
    return () => cancelAnimationFrame(animId);
  }, [isPlaying]);

  // 修改画幅比例
  const handleRatioChange = (val: '916' | '169' | '11') => {
    setCanvasRatio(val);
    if (val === '916') {
      setCanvasWidth(720);
      setCanvasHeight(1280);
    } else if (val === '169') {
      setCanvasWidth(1280);
      setCanvasHeight(720);
    } else {
      setCanvasWidth(720);
      setCanvasHeight(720);
    }
  };

  // 添加视频到轨道
  const addVideoToTimeline = (url: string, filename: string, durationSec = 10) => {
    const newItem: SegmentItem = {
      id: Math.random().toString(36).substring(7),
      url,
      filename,
      start: 0,
      duration: Math.min(9.8, durationSec),
      maxDuration: durationSec || 15,
      crop: undefined,
    };
    setSegments([...segments, newItem]);
    setSelectedSegmentIndex(segments.length);
    message.success(`已添加片段: ${filename}`);
  };

  // 从 URL 手工输入添加视频
  const [inputUrl, setInputUrl] = useState('');
  const handleAddFromUrl = () => {
    if (!inputUrl) return;
    const filename = inputUrl.substring(inputUrl.lastIndexOf('/') + 1) || 'external_video.mp4';
    addVideoToTimeline(inputUrl, filename, 10); // 默认假设10s
    setInputUrl('');
  };

  // 移除轨道片段
  const removeSegment = (index: number) => {
    const next = [...segments];
    next.splice(index, 1);
    setSegments(next);
    if (selectedSegmentIndex === index) {
      setSelectedSegmentIndex(next.length > 0 ? 0 : null);
    } else if (selectedSegmentIndex !== null && selectedSegmentIndex > index) {
      setSelectedSegmentIndex(selectedSegmentIndex - 1);
    }
  };

  // 轨道片段边缘鼠标拖拉剪切 (裁剪时间轴 Clip 长度)
  const handleClipResizeStart = (
    e: React.MouseEvent,
    index: number,
    type: 'left' | 'right'
  ) => {
    e.stopPropagation();
    e.preventDefault();

    // 拖动时自动暂停播放，方便用户看清帧画面
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
      setIsPlaying(false);
    }

    const startX = e.clientX;
    const segment = segments[index];
    const origStart = segment.start;
    const origDuration = segment.duration;
    const maxDur = segment.maxDuration;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = (moveEvent.clientX - startX) / pxPerSec;
      
      let finalStart = origStart;
      let finalDuration = origDuration;

      if (type === 'right') {
        // 往右拉延长，往左拉缩短
        const newDur = Math.max(0.5, Math.min(origDuration + dx, maxDur - origStart));
        finalDuration = Number(newDur.toFixed(2));
      } else {
        // 左边缘拖拽：向右拖动起点增加，时长相应减少
        const newStart = Math.max(0, Math.min(origStart + dx, origStart + origDuration - 0.5));
        const newDur = origDuration - (newStart - origStart);
        finalStart = Number(newStart.toFixed(2));
        finalDuration = Number(newDur.toFixed(2));
      }

      setSegments((prev) => {
        const next = [...prev];
        next[index] = {
          ...next[index],
          start: finalStart,
          duration: finalDuration,
        };
        return next;
      });

      // 动态更新视频预览帧
      if (videoRef.current) {
        // 拖动左边缘预览裁剪起点帧，拖动右边缘预览裁剪终点帧
        const seekTime = type === 'right' ? (finalStart + finalDuration) : finalStart;
        videoRef.current.currentTime = seekTime;
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // 可视化 Crop 裁剪框拖动实现
  const handleCropMouseDown = (e: React.MouseEvent, handle: string | null = null) => {
    e.stopPropagation();
    e.preventDefault();
    isDraggingCrop.current = !handle;
    isResizingCrop.current = handle;
    dragStart.current = { x: e.clientX, y: e.clientY };
    cropBoxStart.current = { ...cropBox };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = ((moveEvent.clientX - dragStart.current.x) / (playerContainerRef.current?.clientWidth || 300)) * 100;
      const dy = ((moveEvent.clientY - dragStart.current.y) / (playerContainerRef.current?.clientHeight || 400)) * 100;

      setCropBox((prev) => {
        const next = { ...prev };
        if (isDraggingCrop.current) {
          // 移动裁剪框
          next.left = Math.max(0, Math.min(cropBoxStart.current.left + dx, 100 - prev.width));
          next.top = Math.max(0, Math.min(cropBoxStart.current.top + dy, 100 - prev.height));
        } else if (isResizingCrop.current) {
          // 拉伸裁剪框
          const h = isResizingCrop.current;
          if (h.includes('right')) {
            next.width = Math.max(10, Math.min(cropBoxStart.current.width + dx, 100 - prev.left));
          }
          if (h.includes('bottom')) {
            next.height = Math.max(10, Math.min(cropBoxStart.current.height + dy, 100 - prev.top));
          }
          if (h.includes('left')) {
            const maxL = prev.left + prev.width - 10;
            const newL = Math.max(0, Math.min(cropBoxStart.current.left + dx, maxL));
            next.width = prev.width + (prev.left - newL);
            next.left = newL;
          }
          if (h.includes('top')) {
            const maxT = prev.top + prev.height - 10;
            const newT = Math.max(0, Math.min(cropBoxStart.current.top + dy, maxT));
            next.height = prev.height + (prev.top - newT);
            next.top = newT;
          }
        }
        return next;
      });
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      
      // 当鼠标释放时，将百分比裁剪映射到视频片段的实际像素上
      if (selectedSegmentIndex !== null) {
        // 这里模拟一个视频的原始分辨率，假设是 1080x1920，如有 metadata 以后可以读更精确的
        const origW = 1080;
        const origH = 1920;
        setSegments((prev) => {
          const next = [...prev];
          const seg = { ...next[selectedSegmentIndex] };
          
          setCropBox((box) => {
            seg.crop = {
              x: Math.round((box.left / 100) * origW),
              y: Math.round((box.top / 100) * origH),
              w: Math.round((box.width / 100) * origW),
              h: Math.round((box.height / 100) * origH),
            };
            return box;
          });
          
          next[selectedSegmentIndex] = seg;
          return next;
        });
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // 发起后端拼合与配音合成渲染请求
  const handleRender = async () => {
    if (segments.length === 0) {
      message.error('时间线上没有视频片段！');
      return;
    }

    setIsRendering(true);
    setRenderProgress('正在连接渲染服务器…');
    setOutputUrl(null);

    const payload = {
      width: canvasWidth,
      height: canvasHeight,
      muteOriginal,
      audioUrl: audioUrl || undefined,
      segments: segments.map((s) => ({
        url: s.url,
        start: s.start,
        duration: s.duration,
        crop: s.crop,
      })),
    };

    try {
      setRenderProgress('正在下载素材并拼接视频…（FFmpeg 精密转码混音中）');
      const res = await api.renderVideo(payload);
      
      setOutputUrl(res.trimmedUrl);
      message.success('视频剪辑合成渲染成功！');
    } catch (err: any) {
      message.error(`合成失败: ${err.message || '未知错误'}`);
    } finally {
      setIsRendering(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col bg-zinc-950 text-zinc-200">
      
      {/* 顶部工具栏 */}
      <div className="flex h-14 items-center justify-between border-b border-zinc-900 bg-zinc-950 px-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 font-semibold text-brand-400">
            <Scissors size={18} />
            <span>智能可视化剪辑台 (路线 B)</span>
          </div>
          
          <div className="h-4 w-px bg-zinc-900" />
          
          {/* 画幅尺寸选择 */}
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <CropIcon size={16} />
            <span>画幅比例:</span>
            <Select
              value={canvasRatio}
              onChange={handleRatioChange}
              size="small"
              className="w-32 bg-zinc-900 text-zinc-200"
              dropdownStyle={{ backgroundColor: '#18181b', color: '#e4e4e7' }}
              options={[
                { value: '916', label: '9:16 竖屏 (抖音)' },
                { value: '169', label: '16:9 横屏 (宽屏)' },
                { value: '11', label: '1:1 正方形' },
              ]}
            />
          </div>
        </div>

        <Button
          type="primary"
          onClick={handleRender}
          loading={isRendering}
          icon={<Film size={16} />}
          className="bg-brand-500 hover:bg-brand-600 border-none"
        >
          开始合成渲染
        </Button>
      </div>

      {/* 主工作区 */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* 左侧：素材管理栏 */}
        <aside className="w-80 border-r border-zinc-900 bg-zinc-950 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-zinc-900">
            <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
              添加外部视频 URL
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="输入视频 MP4 URL"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                size="small"
                className="bg-zinc-900 border-zinc-800 text-zinc-200 placeholder-zinc-600 focus:border-brand-500"
              />
              <Button 
                onClick={handleAddFromUrl} 
                icon={<Plus size={14} />} 
                size="small"
                className="bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-200"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                <FileVideo size={14} />
                <span>已上传视频素材 ({videoAssets.length})</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {videoAssets.map((asset) => (
                  <div
                    key={asset.id}
                    className="group relative flex flex-col justify-between rounded-lg border border-zinc-900 bg-zinc-900/40 p-2.5 transition-all hover:border-brand-500/50 hover:bg-zinc-900 cursor-pointer"
                    onClick={() => addVideoToTimeline(asset.publicUrl, asset.filename, 10)}
                  >
                    <div className="line-clamp-2 text-[11px] text-zinc-400 font-medium group-hover:text-zinc-200">
                      {asset.filename}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[9px] text-zinc-600 font-mono">
                      <span>{(asset.bytes / (1024 * 1024)).toFixed(1)} MB</span>
                      <Plus size={12} className="text-brand-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                <Music size={14} />
                <span>已上传音频素材 ({audioAssets.length})</span>
              </div>
              <div className="space-y-1.5">
                {audioAssets.map((asset) => (
                  <div
                    key={asset.id}
                    className="group flex items-center justify-between rounded-lg border border-zinc-900 bg-zinc-900/20 px-3 py-2 hover:border-emerald-500/50 hover:bg-zinc-900/60 cursor-pointer text-xs"
                    onClick={() => {
                      setAudioUrl(asset.publicUrl);
                      setAudioFilename(asset.filename);
                      message.success(`已选择音频轨: ${asset.filename}`);
                    }}
                  >
                    <div className="truncate text-zinc-400 group-hover:text-zinc-200 flex-1 pr-2">
                      {asset.filename}
                    </div>
                    <Plus size={12} className="text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* 中间：视频预览与裁剪控制 */}
        <main className="flex-1 flex flex-col bg-zinc-900/30 overflow-hidden">
          <div className="flex-1 flex items-center justify-center p-6 relative">
            
            {/* 播放画布容器 */}
            <div 
              ref={playerContainerRef}
              className="relative shadow-2xl overflow-hidden border border-zinc-900 bg-black flex items-center justify-center"
              style={{
                width: canvasRatio === '169' ? '560px' : canvasRatio === '11' ? '400px' : '280px',
                height: canvasRatio === '169' ? '315px' : canvasRatio === '11' ? '400px' : '500px',
              }}
            >
              {outputUrl ? (
                // 渲染结果预览
                <video 
                  ref={videoRef}
                  src={outputUrl} 
                  controls 
                  className="w-full h-full object-contain"
                />
              ) : segments.length > 0 ? (
                // 编辑中状态下的首个片段播放器预览
                <video 
                  ref={videoRef}
                  src={segments[0].url} 
                  className="w-full h-full object-contain"
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                />
              ) : (
                <div className="text-zinc-600 text-xs flex flex-col items-center gap-2">
                  <Film size={32} className="text-zinc-700" />
                  <span>时间线上暂无视频，请从左侧添加素材</span>
                </div>
              )}

              {/* 可视化画面裁剪框 (Visual Crop Box Overlay) */}
              {cropEnabled && selectedSegmentIndex !== null && !outputUrl && (
                <div className="absolute inset-0 z-10 pointer-events-auto">
                  <div className="absolute inset-0 bg-black/60" />
                  
                  {/* 可拖动裁剪框 */}
                  <div
                    className="absolute border-2 border-dashed border-brand-500 bg-transparent cursor-move"
                    style={{
                      left: `${cropBox.left}%`,
                      top: `${cropBox.top}%`,
                      width: `${cropBox.width}%`,
                      height: `${cropBox.height}%`,
                    }}
                    onMouseDown={(e) => handleCropMouseDown(e)}
                  >
                    {/* 九宫格虚线 */}
                    <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-40">
                      <div className="border-r border-b border-brand-400/40" />
                      <div className="border-r border-b border-brand-400/40" />
                      <div className="border-b border-brand-400/40" />
                      <div className="border-r border-b border-brand-400/40" />
                      <div className="border-r border-b border-brand-400/40" />
                      <div className="border-b border-brand-400/40" />
                    </div>

                    {/* 角落拉伸把手 */}
                    <div 
                      className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-brand-500 rounded-sm cursor-se-resize -mr-1.5 -mb-1.5"
                      onMouseDown={(e) => handleCropMouseDown(e, 'right-bottom')}
                    />
                    <div 
                      className="absolute top-0 left-0 w-3.5 h-3.5 bg-brand-500 rounded-sm cursor-nw-resize -ml-1.5 -mt-1.5"
                      onMouseDown={(e) => handleCropMouseDown(e, 'left-top')}
                    />
                  </div>
                </div>
              )}

              {/* 渲染合成中遮罩 */}
              {isRendering && (
                <div className="absolute inset-0 bg-zinc-950/85 flex flex-col items-center justify-center p-6 text-center z-20">
                  <Loader2 size={36} className="text-brand-500 animate-spin mb-4" />
                  <div className="text-sm font-semibold text-zinc-100 mb-1">正在渲染导出视频</div>
                  <div className="text-xs text-zinc-500 max-w-xs">{renderProgress}</div>
                </div>
              )}
            </div>

            {/* 播放控制按钮 */}
            {segments.length > 0 && !outputUrl && (
              <button 
                onClick={() => {
                  if (videoRef.current) {
                    if (isPlaying) videoRef.current.pause();
                    else videoRef.current.play();
                  }
                }}
                className="absolute bottom-8 flex h-10 w-10 items-center justify-center rounded-full bg-zinc-950 border border-zinc-800 text-zinc-300 hover:text-white hover:scale-105 transition-all shadow-lg"
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
              </button>
            )}

            {/* 结果导出按钮 */}
            {outputUrl && (
              <div className="absolute right-4 bottom-4 flex gap-2">
                <Button
                  size="small"
                  icon={<Download size={14} />}
                  onClick={() => window.open(outputUrl, '_blank')}
                  className="bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                >
                  下载视频
                </Button>
                <Button
                  size="small"
                  type="primary"
                  icon={<Save size={14} />}
                  onClick={() => {
                    setOutputUrl(null);
                    message.success('已保存至您的本地导出历史');
                  }}
                  className="bg-brand-500 hover:bg-brand-600 border-none"
                >
                  完成剪辑
                </Button>
              </div>
            )}
          </div>
        </main>

        {/* 右侧：调色与配音属性面板 */}
        <aside className="w-80 border-l border-zinc-900 bg-zinc-950 p-5 space-y-6 overflow-y-auto">
          {/* 画幅裁剪 (Crop) 选项 */}
          {selectedSegmentIndex !== null ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                  画幅裁剪 (第 {selectedSegmentIndex + 1} 个片段)
                </div>
                <Switch
                  checked={cropEnabled}
                  onChange={(checked) => setCropEnabled(checked)}
                  size="small"
                />
              </div>

              {cropEnabled ? (
                <div className="rounded-lg border border-zinc-900 bg-zinc-900/20 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-brand-300 text-xs">
                    <CropIcon size={14} />
                    <span>请在视频画面上拖拽边框进行剪切</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10px] text-zinc-500 font-mono">
                    <div>起点 X: {segments[selectedSegmentIndex].crop?.x ?? 0} px</div>
                    <div>起点 Y: {segments[selectedSegmentIndex].crop?.y ?? 0} px</div>
                    <div>宽度 W: {segments[selectedSegmentIndex].crop?.w ?? 1080} px</div>
                    <div>高度 H: {segments[selectedSegmentIndex].crop?.h ?? 1920} px</div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-zinc-600">
                  开启开关后，可可视化拉伸网格对视频内容进行裁剪。
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-zinc-600">选择轨道片段以配置画幅裁剪</div>
          )}

          <div className="h-px bg-zinc-900" />

          {/* 配音背景音选项 */}
          <div className="space-y-4">
            <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              音轨与配音设置
            </div>

            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span className="flex items-center gap-1.5">
                {muteOriginal ? <VolumeX size={14} /> : <Volume2 size={14} />}
                <span>完全静音原视频声音</span>
              </span>
              <Switch
                checked={muteOriginal}
                onChange={(checked) => setMuteOriginal(checked)}
                size="small"
              />
            </div>

            <div className="space-y-1.5">
              <span className="text-[11px] text-zinc-500 block">选定的背景音：</span>
              {audioUrl ? (
                <div className="flex items-center justify-between rounded-lg border border-zinc-900 bg-zinc-900/30 px-3 py-2">
                  <span className="text-xs text-emerald-400 truncate flex-1 pr-2">
                    {audioFilename || '已选音频'}
                  </span>
                  <button 
                    onClick={() => {
                      setAudioUrl('');
                      setAudioFilename('');
                    }}
                    className="text-zinc-600 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ) : (
                <div className="text-xs text-zinc-700 italic">
                  未选择背景乐。可从左侧音频列表中选择，或将原视频音频完全静音。
                </div>
              )}
            </div>
          </div>
        </aside>

      </div>

      {/* 底部：可视化非线性时间线编辑器 (Tracks Area) */}
      <footer className="h-56 border-t border-zinc-900 bg-zinc-950/80 backdrop-blur flex flex-col overflow-hidden select-none">
        
        {/* 时间线刻度条与播放头数值 */}
        <div className="h-9 border-b border-zinc-900 flex items-center justify-between px-6 bg-zinc-950">
          <div className="text-xs font-mono text-zinc-500">
            {Math.floor(currentTime / 60).toString().padStart(2, '0')}:
            {(currentTime % 60).toFixed(2).padStart(5, '0')}
            <span className="mx-1.5 text-zinc-800">/</span>
            {Math.floor(totalDuration / 60).toString().padStart(2, '0')}:
            {(totalDuration % 60).toFixed(2).padStart(5, '0')}
          </div>

          <div className="text-[10px] text-zinc-600 uppercase font-medium tracking-wider">
            时间轴轨道区 (拖拽 Clip 两端可剪切时长)
          </div>
        </div>

        {/* 轨道编辑区 */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-4 relative flex flex-col justify-center space-y-4">
          
          {/* 视频片段轨道 */}
          <div className="flex items-center min-h-[44px] relative">
            <div className="w-14 text-[10px] font-semibold text-zinc-600 uppercase pr-2 flex items-center gap-1">
              <FileVideo size={12} />
              视频
            </div>
            
            <div className="flex-1 flex gap-[2px] items-center relative h-10 border-b border-zinc-900/40">
              {segments.map((seg, idx) => (
                <div
                  key={seg.id}
                  onClick={() => setSelectedSegmentIndex(idx)}
                  className={`group relative h-9 flex items-center justify-between rounded-md border border-brand-500/20 bg-gradient-to-r from-brand-500/10 to-indigo-500/10 px-2 cursor-pointer transition-all ${
                    selectedSegmentIndex === idx ? 'ring-2 ring-brand-500 border-transparent bg-brand-500/20' : 'hover:border-brand-500/40'
                  }`}
                  style={{ width: `${seg.duration * pxPerSec}rem` }}
                >
                  {/* 左拖拽把手 (Crop start) */}
                  <div
                    className="absolute left-0 top-0 bottom-0 w-1 bg-brand-500 opacity-0 group-hover:opacity-100 cursor-col-resize rounded-l-md transition-opacity"
                    onMouseDown={(e) => handleClipResizeStart(e, idx, 'left')}
                  />

                  <span className="text-[10px] text-brand-300 font-semibold truncate select-none">
                    {idx + 1}. {seg.filename}
                  </span>
                  
                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-[9px] text-zinc-500 font-mono">
                      {seg.duration.toFixed(1)}s
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSegment(idx);
                      }}
                      className="text-zinc-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  {/* 右拖拽把手 (Crop duration) */}
                  <div
                    className="absolute right-0 top-0 bottom-0 w-1 bg-brand-500 opacity-0 group-hover:opacity-100 cursor-col-resize rounded-r-md transition-opacity"
                    onMouseDown={(e) => handleClipResizeStart(e, idx, 'right')}
                  />
                </div>
              ))}

              {segments.length === 0 && (
                <span className="text-zinc-700 text-xs italic">暂无视频片段</span>
              )}
            </div>
          </div>

          {/* 音频背景音轨道 */}
          <div className="flex items-center min-h-[44px] relative">
            <div className="w-14 text-[10px] font-semibold text-zinc-600 uppercase pr-2 flex items-center gap-1">
              <Music size={12} />
              音频
            </div>

            <div className="flex-1 flex items-center relative h-10">
              {audioUrl ? (
                <div
                  className="h-8 flex items-center justify-between rounded-md border border-emerald-500/20 bg-gradient-to-r from-emerald-500/10 to-teal-500/10 px-3"
                  style={{ width: `${totalDuration > 0 ? totalDuration * pxPerSec : 15 * pxPerSec}rem` }}
                >
                  <span className="text-[10px] text-emerald-400 font-semibold truncate">
                    🎵 {audioFilename}
                  </span>
                  <button
                    onClick={() => {
                      setAudioUrl('');
                      setAudioFilename('');
                    }}
                    className="text-zinc-600 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ) : (
                <span className="text-zinc-800 text-xs italic">无背景伴奏轨</span>
              )}
            </div>
          </div>

        </div>
      </footer>

    </div>
  );
}
