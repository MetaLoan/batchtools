import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Dropdown, Button } from 'antd';
import {
  LayoutGrid,
  ListChecks,
  History,
  Image as ImageIcon,
  Settings as SettingsIcon,
  Type,
  Video,
  Film,
  Wand2,
  ImagePlus,
  Scissors,
  LogOut,
  ChevronDown,
} from 'lucide-react';
import clsx from 'clsx';
import { useCapabilities } from '../App';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAppStore } from '../lib/store';
import AccountSwitcher from './AccountSwitcher';

const CAP_ICONS: Record<string, JSX.Element> = {
  't2i': <Type size={16} />,
  'i2i': <ImagePlus size={16} />,
  't2v': <Video size={16} />,
  'i2v': <Film size={16} />,
  'r2v': <Wand2 size={16} />,
  'v2v': <Scissors size={16} />,
};

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: capabilities = [] } = useCapabilities();
  const [isMobile, setIsMobile] = useState(false);

  const acknowledgedFinishedJobIds = useAppStore((s) => s.acknowledgedFinishedJobIds) || [];

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.listJobs(200).then((r) => r.jobs),
    refetchInterval: 8000,
  });

  const generatingCount = jobs.filter((j) => j.status === 'RUNNING' || j.status === 'QUEUED').length;
  const finishedJobs = jobs.filter((j) => j.status !== 'RUNNING' && j.status !== 'QUEUED');
  const newFinishedCount = finishedJobs.filter((j) => !acknowledgedFinishedJobIds.includes(j.id)).length;

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = () => setIsMobile(mq.matches);
    handler();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  if (isMobile) {
    return <MobileLayout generatingCount={generatingCount} newFinishedCount={newFinishedCount} />;
  }

  const generatingBadge = generatingCount > 0 ? (
    <span className="flex h-5 items-center justify-center rounded-full bg-brand-500/20 px-1.5 text-xs font-medium text-brand-300 ring-1 ring-inset ring-brand-500/30 animate-pulse">
      {generatingCount}
    </span>
  ) : null;

  const newFinishedBadge = newFinishedCount > 0 ? (
    <span className="flex h-5 items-center justify-center rounded-full bg-emerald-500/20 px-1.5 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
      +{newFinishedCount}
    </span>
  ) : null;

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <aside className="flex w-64 flex-col border-r border-zinc-900 bg-zinc-950">
        <div className="flex h-14 items-center gap-2 border-b border-zinc-900 px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500/15 text-brand-400">
            <Wand2 size={16} />
          </div>
          <span className="text-sm font-semibold">素材推广平台</span>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          <div className="px-2 pb-2 text-xs font-medium uppercase tracking-wider text-zinc-600">
            工作台
          </div>
          <NavItem
            icon={<LayoutGrid size={16} />}
            label="总览"
            active={location.pathname === '/'}
            onClick={() => navigate('/')}
          />

          <div className="mt-4 px-2 pb-2 text-xs font-medium uppercase tracking-wider text-zinc-600">
            能力
          </div>
          {capabilities.map((cap) => (
            <NavItem
              key={cap.id}
              icon={CAP_ICONS[cap.category]}
              label={cap.shortName}
              active={location.pathname === `/c/${cap.id}`}
              onClick={() => navigate(`/c/${cap.id}`)}
            />
          ))}

          <div className="mt-4 px-2 pb-2 text-xs font-medium uppercase tracking-wider text-zinc-600">
            中心
          </div>
          <NavItem
            icon={<ListChecks size={16} />}
            label="队列"
            active={location.pathname === '/queue'}
            onClick={() => navigate('/queue')}
            badge={generatingBadge}
          />
          <NavItem
            icon={<History size={16} />}
            label="任务历史"
            active={location.pathname.startsWith('/tasks')}
            onClick={() => navigate('/tasks')}
            badge={newFinishedBadge}
          />
          <NavItem
            icon={<ImageIcon size={16} />}
            label="素材库"
            active={location.pathname === '/assets'}
            onClick={() => navigate('/assets')}
          />
          <NavItem
            icon={<Scissors size={16} />}
            label="视频剪辑"
            active={location.pathname === '/editor'}
            onClick={() => navigate('/editor')}
          />
          <NavItem
            icon={<Wand2 size={16} />}
            label="人设策略自动化"
            active={location.pathname === '/strategies'}
            onClick={() => navigate('/strategies')}
          />
          <NavItem
            icon={<SettingsIcon size={16} />}
            label="账户设置"
            active={location.pathname === '/settings'}
            onClick={() => navigate('/settings')}
          />
        </nav>

        <div className="border-t border-zinc-900 p-3">
          <UserMenu />
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-900 bg-zinc-950 px-6">
          <div className="text-sm text-zinc-500">
            {breadcrumbForPath(location.pathname, capabilities)}
          </div>
          <AccountSwitcher />
        </header>
        <main className="flex-1 overflow-y-auto bg-zinc-950">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function MobileLayout({
  generatingCount,
  newFinishedCount,
}: {
  generatingCount: number;
  newFinishedCount: number;
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const generatingMobileBadge = generatingCount > 0 ? (
    <span className="absolute right-4 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-brand-500 text-[9px] font-bold text-white animate-pulse">
      {generatingCount}
    </span>
  ) : null;

  const newFinishedMobileBadge = newFinishedCount > 0 ? (
    <span className="absolute right-4 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-bold text-white">
      {newFinishedCount}
    </span>
  ) : null;

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-900 px-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500/15 text-brand-400">
            <Wand2 size={14} />
          </div>
          <span className="text-sm font-semibold">素材推广平台</span>
        </div>
        <AccountSwitcher compact />
      </header>
      <main className="flex-1 overflow-y-auto pb-16">
        <Outlet />
      </main>
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-zinc-900 bg-zinc-950/95 backdrop-blur">
        <MobileTab
          icon={<LayoutGrid size={20} />}
          label="工作台"
          active={location.pathname === '/' || location.pathname.startsWith('/c/')}
          onClick={() => navigate('/')}
        />
        <MobileTab
          icon={<ListChecks size={20} />}
          label="队列"
          active={location.pathname === '/queue'}
          onClick={() => navigate('/queue')}
          badge={generatingMobileBadge}
        />
        <MobileTab
          icon={<History size={20} />}
          label="任务"
          active={location.pathname.startsWith('/tasks')}
          onClick={() => navigate('/tasks')}
          badge={newFinishedMobileBadge}
        />
        <MobileTab
          icon={<ImageIcon size={20} />}
          label="素材"
          active={location.pathname === '/assets'}
          onClick={() => navigate('/assets')}
        />
        <MobileTab
          icon={<SettingsIcon size={20} />}
          label="我的"
          active={location.pathname === '/settings'}
          onClick={() => navigate('/settings')}
        />
      </nav>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon?: JSX.Element;
  label: string;
  active?: boolean;
  onClick: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors',
        active
          ? 'bg-brand-500/15 text-brand-200'
          : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="flex h-5 w-5 items-center justify-center">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      {badge}
    </button>
  );
}

function MobileTab({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: JSX.Element;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'relative flex h-full min-w-[44px] flex-1 flex-col items-center justify-center gap-1 text-[11px]',
        active ? 'text-brand-400' : 'text-zinc-500'
      )}
    >
      {icon}
      <span>{label}</span>
      {badge}
    </button>
  );
}

function UserMenu() {
  const navigate = useNavigate();
  const currentUser = useAppStore((s) => s.currentUser);
  async function logout() {
    await api.logout();
    window.location.href = '/login';
  }
  return (
    <Dropdown
      menu={{
        items: [
          { key: 'settings', label: '账户设置', onClick: () => navigate('/settings') },
          { key: 'logout', label: '退出登录', icon: <LogOut size={14} />, onClick: logout },
        ],
      }}
      trigger={['click']}
    >
      <button className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm text-zinc-300 hover:bg-zinc-900">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-xs font-medium text-brand-300">
            {(currentUser?.username ?? '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-left text-sm">
              {currentUser?.displayName ?? currentUser?.username ?? '未登录'}
            </div>
            {currentUser?.isAdmin && (
              <div className="text-left text-[10px] text-brand-400">管理员</div>
            )}
          </div>
        </div>
        <ChevronDown size={14} />
      </button>
    </Dropdown>
  );
}

function breadcrumbForPath(pathname: string, capabilities: { id: string; displayName: string }[]) {
  if (pathname === '/') return '总览';
  if (pathname.startsWith('/c/')) {
    const id = pathname.replace('/c/', '');
    return capabilities.find((c) => c.id === id)?.displayName ?? '能力';
  }
  if (pathname.startsWith('/queue')) return '队列中心';
  if (pathname.startsWith('/tasks')) return '任务历史';
  if (pathname.startsWith('/assets')) return '素材库';
  if (pathname.startsWith('/editor')) return '视频剪辑';
  if (pathname.startsWith('/strategies')) return '人设策略自动化';
  if (pathname.startsWith('/settings')) return '账户设置';
  return '';
}
