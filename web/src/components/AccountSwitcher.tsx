import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dropdown, Button, Empty } from 'antd';
import type { MenuProps } from 'antd';
import { User, ChevronDown } from 'lucide-react';
import { api } from '../lib/api';
import { useAppStore } from '../lib/store';

const ENDPOINT_SHORT: Record<string, string> = {
  'https://dashscope-intl.aliyuncs.com': '新加坡',
  'https://dashscope.aliyuncs.com': '北京',
  'https://dashscope-us.aliyuncs.com': '美西',
};

export default function AccountSwitcher({ compact }: { compact?: boolean }) {
  const accountId = useAppStore((s) => s.currentAccountId);
  const setAccountId = useAppStore((s) => s.setCurrentAccountId);
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.listAccounts().then((r) => r.accounts),
    refetchInterval: 60_000,
  });
  const current = accounts.find((a) => a.id === accountId);

  useEffect(() => {
    if (!accountId && accounts.length > 0) {
      setAccountId(accounts[0].id);
    }
    if (accountId && accounts.length > 0 && !accounts.find((a) => a.id === accountId)) {
      setAccountId(accounts[0].id);
    }
  }, [accountId, accounts, setAccountId]);

  const items: MenuProps['items'] =
    accounts.length === 0
      ? [
          {
            key: 'empty',
            disabled: true,
            label: (
              <span className="text-zinc-500">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={<span className="text-xs">运维尚未配置 DashScope 账户</span>}
                />
              </span>
            ),
          },
        ]
      : accounts.map((a) => ({
          key: a.id,
          label: (
            <div className="flex items-center justify-between gap-3">
              <span>{a.name}</span>
              <span className="text-[10px] text-zinc-500">
                {ENDPOINT_SHORT[a.endpoint] ?? '自定义'}
              </span>
            </div>
          ),
          onClick: () => setAccountId(a.id),
        }));

  return (
    <Dropdown menu={{ items }} trigger={['click']}>
      <Button type="text" size={compact ? 'small' : 'middle'} className="!h-9 !px-3">
        <span className="flex items-center gap-2 text-sm">
          <User size={14} />
          <span className="max-w-[140px] truncate">
            {current?.name ?? (accounts.length === 0 ? '无可用账户' : '选择账户')}
          </span>
          {current && (
            <span className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-400">
              {ENDPOINT_SHORT[current.endpoint] ?? '自定义'}
            </span>
          )}
          <ChevronDown size={14} />
        </span>
      </Button>
    </Dropdown>
  );
}
