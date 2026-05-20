import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, Form, Input, App as AntApp, Switch, Empty, Tag, Tooltip } from 'antd';
import { Trash2, Plus, KeyRound } from 'lucide-react';
import { api } from '../lib/api';
import { useAppStore } from '../lib/store';
import { formatRelative } from '../lib/format';

export default function SettingsPage() {
  const qc = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const accountId = useAppStore((s) => s.currentAccountId);
  const setAccountId = useAppStore((s) => s.setCurrentAccountId);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.listAccounts().then((r) => r.accounts),
  });

  const createMut = useMutation({
    mutationFn: (input: {
      name: string;
      apiKey: string;
      disableDataInspection?: boolean;
    }) => api.createAccount(input),
    onSuccess: (acc) => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setAccountId(acc.id);
      setOpen(false);
      form.resetFields();
      message.success('账户已添加');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteAccount(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      if (accountId === id) setAccountId(null);
      message.success('已删除');
    },
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">账户设置</h1>
          <p className="mt-1 text-sm text-zinc-500">管理多把 DashScope API Key (新加坡站)</p>
        </div>
        <Button type="primary" icon={<Plus size={14} />} onClick={() => setOpen(true)}>
          添加账户
        </Button>
      </div>

      {isLoading ? (
        <div className="text-zinc-500">加载中…</div>
      ) : accounts.length === 0 ? (
        <Empty description="还没有账户，点击右上角添加">
          <Button type="primary" onClick={() => setOpen(true)}>
            添加第一个账户
          </Button>
        </Empty>
      ) : (
        <div className="space-y-2">
          {accounts.map((a) => (
            <div
              key={a.id}
              className={`surface flex items-center justify-between p-4 ${
                accountId === a.id ? '!border-brand-500/60' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <KeyRound size={14} className="text-brand-400" />
                  <span className="text-sm font-medium">{a.name}</span>
                  {accountId === a.id && (
                    <Tag color="processing" bordered={false}>
                      当前
                    </Tag>
                  )}
                  {a.disableDataInspection && (
                    <Tooltip title="X-DashScope-DataInspection: disable">
                      <Tag color="warning" bordered={false}>
                        关数据检查
                      </Tag>
                    </Tooltip>
                  )}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  并发 {a.policy.maxConcurrentRunning} · 速率 {a.policy.submitRatePerMin}/min · 创建{' '}
                  {formatRelative(a.createdAt)}
                </div>
              </div>
              <div className="flex gap-2">
                {accountId !== a.id && (
                  <Button size="small" onClick={() => setAccountId(a.id)}>
                    切换
                  </Button>
                )}
                <Button
                  size="small"
                  danger
                  icon={<Trash2 size={12} />}
                  onClick={() =>
                    modal.confirm({
                      title: `删除账户 ${a.name}?`,
                      content: '这只删除本地配置，DashScope 端的 API Key 不会受影响',
                      okButtonProps: { danger: true },
                      onOk: () => deleteMut.mutate(a.id),
                    })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        title="添加账户"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        okText="保存"
        cancelText="取消"
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => createMut.mutate(v)}
          initialValues={{ disableDataInspection: false }}
        >
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="主号 / 测试号 ..." />
          </Form.Item>
          <Form.Item
            name="apiKey"
            label="DashScope API Key"
            rules={[{ required: true, message: '请输入 API Key' }]}
            extra="存储时会加密，仅在调用 DashScope 时解密"
          >
            <Input.Password placeholder="sk-..." />
          </Form.Item>
          <Form.Item
            name="disableDataInspection"
            label="关闭数据检查"
            valuePropName="checked"
            extra="为请求注入 X-DashScope-DataInspection: disable"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
