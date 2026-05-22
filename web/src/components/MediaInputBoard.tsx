import { useState } from 'react';
import { Upload, App as AntApp, Tooltip } from 'antd';
import { Plus, X, Image as ImageIcon, Video as VideoIcon, Music } from 'lucide-react';
import type { Capability, MediaInput, MediaSlot } from '@bvp/shared';
import { api } from '../lib/api';
import { formatBytes } from '../lib/format';

interface Props {
  capability: Capability;
  value: MediaInput[];
  onChange: (next: MediaInput[]) => void;
}

const ACCEPT_MAP: Record<string, string> = {
  image: 'image/png,image/jpeg,image/jpg,image/webp,image/bmp',
  video: 'video/mp4,video/quicktime,video/webm',
  audio: 'audio/wav,audio/mpeg,audio/mp3',
};

function slotKindIcon(slot: MediaSlot) {
  if (slot.accept.includes('image')) return <ImageIcon size={14} />;
  if (slot.accept.includes('video')) return <VideoIcon size={14} />;
  if (slot.accept.includes('audio')) return <Music size={14} />;
  return null;
}

function resizeImageIfNeeded(file: File): Promise<File> {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) {
      resolve(file);
      return;
    }
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.src = objectUrl;
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const minDimension = 240;
      if (img.width >= minDimension && img.height >= minDimension) {
        resolve(file);
        return;
      }
      
      const scale = Math.max(minDimension / img.width, minDimension / img.height);
      const newWidth = Math.round(img.width * scale);
      const newHeight = Math.round(img.height * scale);
      
      const canvas = document.createElement('canvas');
      canvas.width = newWidth;
      canvas.height = newHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(file);
        return;
      }
      
      ctx.drawImage(img, 0, 0, newWidth, newHeight);
      
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const resizedFile = new File([blob], file.name, {
            type: file.type || 'image/png',
            lastModified: Date.now(),
          });
          resolve(resizedFile);
        },
        file.type || 'image/png',
        0.95
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };
  });
}

export default function MediaInputBoard({ capability, value, onChange }: Props) {
  const { message } = AntApp.useApp();
  const [busy, setBusy] = useState<string | null>(null);

  if (capability.mediaSpec.mode === 'none') return null;
  const slots = capability.mediaSpec.slots;

  async function uploadFor(slot: MediaSlot, file: File) {
    setBusy(slot.kind);
    try {
      const targetFile = await resizeImageIfNeeded(file);
      const result = await api.uploadFile(targetFile);
      const next: MediaInput = {
        kind: slot.kind,
        url: result.publicUrl,
        localId: result.id,
        meta: { mime: result.mime, bytes: result.bytes },
      };
      const existing = value.filter((m) => m.kind === slot.kind);
      if (existing.length + 1 > slot.max) {
        message.warning(`${slot.label ?? slot.kind} 最多 ${slot.max} 个`);
        return false;
      }
      onChange([...value, next]);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(null);
    }
    return false;
  }

  function removeAt(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-4">
      {slots.map((slot) => {
        const items = value
          .map((m, i) => ({ m, i }))
          .filter(({ m }) => m.kind === slot.kind);
        const accept = slot.accept.map((a) => ACCEPT_MAP[a]).filter(Boolean).join(',');
        return (
          <div key={slot.kind} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center text-zinc-400">
                  {slotKindIcon(slot)}
                </span>
                <span className="text-sm font-medium">{slot.label ?? slot.kind}</span>
                {slot.required && <span className="text-xs text-rose-400">必填</span>}
                <span className="text-xs text-zinc-500">
                  ({items.length}/{slot.max})
                </span>
              </div>
              {slot.hint && (
                <Tooltip title={slot.hint}>
                  <span className="text-xs text-zinc-500">说明</span>
                </Tooltip>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {items.map(({ m, i }) => (
                <MediaCard key={i} media={m} onRemove={() => removeAt(i)} />
              ))}
              {items.length < slot.max && (
                <Upload
                  beforeUpload={(file) => uploadFor(slot, file as File)}
                  showUploadList={false}
                  accept={accept}
                  multiple={false}
                  capture={slot.accept.includes('image') ? 'environment' : undefined}
                >
                  <button
                    type="button"
                    className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-800 text-zinc-500 hover:border-brand-500 hover:text-brand-400"
                  >
                    <Plus size={20} />
                    <span className="text-xs">
                      {busy === slot.kind ? '上传中…' : `添加${slot.label ?? ''}`}
                    </span>
                  </button>
                </Upload>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MediaCard({ media, onRemove }: { media: MediaInput; onRemove: () => void }) {
  const mime = media.meta?.mime ?? '';
  const isImage = mime.startsWith('image/');
  const isVideo = mime.startsWith('video/');
  return (
    <div className="surface group relative aspect-square overflow-hidden">
      {isImage ? (
        <img src={media.url} alt="" className="h-full w-full object-cover" />
      ) : isVideo ? (
        <video src={media.url} className="h-full w-full object-cover" muted />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center text-zinc-500">
          <Music size={20} />
          <span className="mt-1 text-xs">音频</span>
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 rounded-md bg-black/70 p-1 text-zinc-300 opacity-0 transition-opacity hover:text-rose-400 group-hover:opacity-100"
      >
        <X size={12} />
      </button>
      {media.meta?.bytes && (
        <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 text-[10px] text-zinc-400">
          {formatBytes(media.meta.bytes)}
        </div>
      )}
    </div>
  );
}
