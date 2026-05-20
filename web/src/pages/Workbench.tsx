import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Type, Video, Film, Wand2, ArrowRight } from 'lucide-react';
import { useCapabilities } from '../App';

const CAT_ICON: Record<string, JSX.Element> = {
  t2i: <Type size={20} />,
  t2v: <Video size={20} />,
  i2v: <Film size={20} />,
  r2v: <Wand2 size={20} />,
};

export default function Workbench() {
  const navigate = useNavigate();
  const { data: capabilities = [], isLoading } = useCapabilities();

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">工作台</h1>
        <p className="mt-1 text-sm text-zinc-500">
          选一个能力开始生成，或前往任务历史 / 队列查看进度
        </p>
      </div>
      {isLoading ? (
        <div className="text-zinc-500">加载能力中…</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((cap, idx) => (
            <motion.button
              key={cap.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04 }}
              onClick={() => navigate(`/c/${cap.id}`)}
              className="surface surface-hover group cursor-pointer p-5 text-left"
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/10 text-brand-400">
                  {CAT_ICON[cap.category]}
                </div>
                <ArrowRight size={16} className="text-zinc-600 transition-transform group-hover:translate-x-1 group-hover:text-brand-400" />
              </div>
              <div className="text-base font-medium">{cap.displayName}</div>
              <div className="mt-1 text-xs text-zinc-500">{cap.description}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {cap.models.slice(0, 3).map((m) => (
                  <span key={m.value} className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-400">
                    {m.label}
                  </span>
                ))}
              </div>
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}
