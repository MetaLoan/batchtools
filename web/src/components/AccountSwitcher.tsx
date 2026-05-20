import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dropdown, Button, Empty } from 'antd';
import type { MenuProps } from 'antd';
import { User, Plus, ChevronDown } from 'lucide-react';
import { api } from '../lib/api';
import { useAppStore } from '../lib/store';
import { useNavigate } from 'react-router-dom';

export default function AccountSwitcher({ compact }: { compact?: boolean }) {
  const navigate = useNavigate();
  const accountId = useAppStore((s) => s.currentAccountId);
  const setAccountId = useAppStore((s) => s.setCurrentAccountId);
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.listAccounts().then((r) => r.accounts),
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
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无账户" />
              </span>
            ),
          },
        ]
      : accounts.map((a) => ({
          key: a.id,
          label: a.name,
          onClick: () => setAccountId(a.id),
        }));

  items.push({ type: 'divider' });
  items.push({
    key: 'manage',
    label: (
      <span className="flex items-center gap-1 text-brand-400">
        <Plus size={14} /> 添加 / 管理账户
      </span>
    ),
    onClick: () => navigate('/settings'),
  });

  return (
    <Dropdown menu={{ items }} trigger={['click']}>
      <Button type="text" size={compact ? 'small' : 'middle'} className="!h-9 !px-3">
        <span className="flex items-center gap-2 text-sm">
          <User size={14} />
          <span className="max-w-[120px] truncate">{current?.name ?? '选择账户'}</span>
          <ChevronDown size={14} />
        </span>
      </Button>
    </Dropdown>
  );
}
