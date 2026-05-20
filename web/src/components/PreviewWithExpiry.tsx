import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Clock } from 'lucide-react';
import { formatCountdown } from '../lib/format';

export default function PreviewWithExpiry({
  url,
  expiresAt,
  kind,
}: {
  url: string;
  expiresAt: string | number;
  kind: 'image' | 'video';
}) {
  const expTs = typeof expiresAt === 'string' ? new Date(expiresAt).getTime() : expiresAt;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const remaining = expTs - Date.now();
  const expired = remaining <= 0;
  const danger = !expired && remaining < 2 * 3600 * 1000;

  return (
    <div className="surface relative overflow-hidden">
      {kind === 'image' ? (
        <img
          src={url}
          alt=""
          className={clsx('block w-full', expired && 'opacity-50 grayscale')}
          loading="lazy"
        />
      ) : (
        <video
          src={url}
          className={clsx('block w-full', expired && 'opacity-50 grayscale')}
          controls
          preload="metadata"
        />
      )}
      <div
        className={clsx(
          'absolute right-2 top-2 flex items-center gap-1 rounded-md px-2 py-0.5 text-xs backdrop-blur',
          expired
            ? 'bg-zinc-900/80 text-zinc-500'
            : danger
              ? 'bg-amber-500/20 text-amber-200'
              : 'bg-black/60 text-zinc-300'
        )}
      >
        <Clock size={12} />
        <span suppressHydrationWarning>{formatCountdown(expTs)}</span>
        {tick < 0 ? null : null}
      </div>
    </div>
  );
}
