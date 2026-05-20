import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, Form, Input, App as AntApp, Switch, Empty, Tag, Tooltip, Tabs, Select } from 'antd';
import { Trash2, Plus, KeyRound, UserPlus, ShieldCheck, ShieldOff, CheckCircle2, AlertTriangle, Wifi } from 'lucide-react';
import { api, type CurrentUser } from '../lib/api';
import { useAppStore } from '../lib/store';
import { formatRelative } from '../lib/format';

export default function SettingsPage() {
  const currentUser = useAppStore((s) => s.currentUser);
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">设置</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {currentUser?.isAdmin
            ? '管理你的 DashScope 账户、密码与全平台用户'
            : '管理你的 DashScope 账户与密码'}
        </p>
      </div>
      <Tabs
        items={[
          { key: 'dashscope', label: 'DashScope 账户', children: <DashScopeAccountsTab /> },
          { key: 'password', label: '修改密码', children: <ChangePasswordTab /> },
          ...(currentUser?.isAdmin
            ? [{ key: 'users', label: '用户管理', children: <UsersTab /> }]
            : []),
        ]}
      />
    </div>
  );
}

const ENDPOINT_OPTIONS = [
  { value: 'https://dashscope-intl.aliyuncs.com', label: '🇸🇬 新加坡', short: '新加坡' },
  { value: 'https://dashscope.aliyuncs.com', label: '🇨🇳 北京', short: '北京' },
  { value: 'https://dashscope-us.aliyuncs.com', label: '🇺🇸 美西 (弗吉尼亚)', short: '美西' },
];

function endpointShortName(url: string): string {
  return ENDPOINT_OPTIONS.find((o) => o.value === url)?.short ?? '自定义';
}

function DashScopeAccountsTab() {
  const qc = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const accountId = useAppStore((s) => s.currentAccountId);
  const setAccountId = useAppStore((s) => s.setCurrentAccountId);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; label: string; hint?: string }>>({});

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.listAccounts().then((r) => r.accounts),
  });

  const createMut = useMutation({
    mutationFn: (input: { name: string; apiKey: string; endpoint?: string; disableDataInspection?: boolean }) =>
      api.createAccount(input),
    onSuccess: (acc) => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setAccountId(acc.id);
      setOpen(false);
      form.resetFields();
      message.success('账户已添加');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const testMut = useMutation({
    mutationFn: (id: string) => api.testAccount(id).then((r) => ({ id, r })),
    onSuccess: ({ id, r }) => {
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          ok: r.ok,
          label: r.ok
            ? r.message ?? '连接正常'
            : `${r.code ?? '错误'}${r.message ? ': ' + r.message : ''}`,
          hint: r.hint,
        },
      }));
      if (r.ok) message.success('连接正常');
      else message.error(r.hint ?? r.message ?? '连接失败');
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
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-zinc-500">仅你自己可见，互不可见于其他用户</p>
        <Button type="primary" icon={<Plus size={14} />} onClick={() => setOpen(true)}>
          添加账户
        </Button>
      </div>
      {isLoading ? (
        <div className="text-zinc-500">加载中…</div>
      ) : accounts.length === 0 ? (
        <Empty description="还没有账户">
          <Button type="primary" onClick={() => setOpen(true)}>
            添加第一个账户
          </Button>
        </Empty>
      ) : (
        <div className="space-y-2">
          {accounts.map((a) => {
            const test = testResults[a.id];
            return (
              <div
                key={a.id}
                className={`surface p-4 ${accountId === a.id ? '!border-brand-500/60' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <KeyRound size={14} className="text-brand-400" />
                      <span className="text-sm font-medium">{a.name}</span>
                      <Tag bordered={false} color="default">
                        {endpointShortName(a.endpoint)}
                      </Tag>
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
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="small"
                      icon={<Wifi size={12} />}
                      loading={testMut.isPending && testMut.variables === a.id}
                      onClick={() => testMut.mutate(a.id)}
                    >
                      测试
                    </Button>
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
                {test && (
                  <div
                    className={`mt-2 flex items-start gap-2 rounded-md px-3 py-2 text-xs ${
                      test.ok
                        ? 'bg-emerald-500/10 text-emerald-300'
                        : 'bg-rose-500/10 text-rose-300'
                    }`}
                  >
                    {test.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                    <div className="min-w-0 flex-1">
                      <div>{test.label}</div>
                      {test.hint && <div className="mt-0.5 text-[11px] opacity-80">{test.hint}</div>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
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
          initialValues={{
            disableDataInspection: false,
            endpoint: 'https://dashscope-intl.aliyuncs.com',
          }}
        >
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="主号 / 测试号 ..." />
          </Form.Item>
          <Form.Item
            name="endpoint"
            label="DashScope 地域"
            rules={[{ required: true, message: '请选择地域' }]}
            extra="Key 在哪个地域申请的就选哪个；选错会报 InvalidApiKey"
          >
            <Select options={ENDPOINT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
          </Form.Item>
          <Form.Item
            name="apiKey"
            label="DashScope API Key"
            rules={[{ required: true, message: '请输入 API Key' }]}
            normalize={(v: string) => (typeof v === 'string' ? v.trim() : v)}
            extra="存储时会加密，仅在调用 DashScope 时解密。粘贴前后的空格会自动去掉"
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

function ChangePasswordTab() {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const mut = useMutation({
    mutationFn: (v: { oldPassword: string; newPassword: string }) =>
      api.changePassword(v.oldPassword, v.newPassword),
    onSuccess: () => {
      message.success('密码已修改');
      form.resetFields();
    },
    onError: (e: Error) => message.error(e.message),
  });

  return (
    <div className="max-w-md">
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => mut.mutate(v)}
        requiredMark={false}
      >
        <Form.Item
          name="oldPassword"
          label="当前密码"
          rules={[{ required: true, message: '请输入当前密码' }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 6, message: '至少 6 位' },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="再次输入新密码"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                return Promise.reject(new Error('两次输入不一致'));
              },
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={mut.isPending}>
          修改密码
        </Button>
      </Form>
    </div>
  );
}

function UsersTab() {
  const qc = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const currentUser = useAppStore((s) => s.currentUser);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [resetTarget, setResetTarget] = useState<CurrentUser | null>(null);
  const [resetForm] = Form.useForm();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.listUsers().then((r) => r.users),
  });

  const createMut = useMutation({
    mutationFn: (v: { username: string; password: string; displayName?: string; isAdmin?: boolean }) =>
      api.createUser(v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      message.success('用户已创建');
      setOpen(false);
      form.resetFields();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const toggleAdminMut = useMutation({
    mutationFn: (v: { id: string; isAdmin: boolean }) =>
      api.updateUser(v.id, { isAdmin: v.isAdmin }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      message.success('已更新');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const resetMut = useMutation({
    mutationFn: (v: { id: string; newPassword: string }) => api.resetUserPassword(v.id, v.newPassword),
    onSuccess: () => {
      message.success('密码已重置');
      setResetTarget(null);
      resetForm.resetFields();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteUser(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      message.success('已删除');
    },
    onError: (e: Error) => message.error(e.message),
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          创建团队成员账号。每个用户的 DashScope 账户、任务、上传相互不可见。
        </p>
        <Button type="primary" icon={<UserPlus size={14} />} onClick={() => setOpen(true)}>
          新建用户
        </Button>
      </div>

      {isLoading ? (
        <div className="text-zinc-500">加载中…</div>
      ) : (
        <div className="space-y-2">
          {users.map((u) => {
            const isSelf = u.id === currentUser?.id;
            return (
              <div key={u.id} className="surface flex items-center justify-between p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-xs font-medium text-brand-300">
                      {u.username.slice(0, 1).toUpperCase()}
                    </div>
                    <span className="text-sm font-medium">{u.displayName ?? u.username}</span>
                    <span className="text-xs text-zinc-500">@{u.username}</span>
                    {u.isAdmin && (
                      <Tag color="processing" bordered={false}>
                        管理员
                      </Tag>
                    )}
                    {isSelf && (
                      <Tag bordered={false}>
                        你
                      </Tag>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    创建 {formatRelative(u.createdAt)}
                    {u.lastLoginAt && ` · 上次登录 ${formatRelative(u.lastLoginAt)}`}
                  </div>
                </div>
                <div className="flex gap-2">
                  {!isSelf && (
                    <>
                      <Tooltip title={u.isAdmin ? '降为普通用户' : '设为管理员'}>
                        <Button
                          size="small"
                          icon={u.isAdmin ? <ShieldOff size={12} /> : <ShieldCheck size={12} />}
                          onClick={() => toggleAdminMut.mutate({ id: u.id, isAdmin: !u.isAdmin })}
                          loading={toggleAdminMut.isPending}
                        />
                      </Tooltip>
                      <Button size="small" icon={<KeyRound size={12} />} onClick={() => setResetTarget(u)}>
                        重置密码
                      </Button>
                      <Button
                        size="small"
                        danger
                        icon={<Trash2 size={12} />}
                        onClick={() =>
                          modal.confirm({
                            title: `删除用户 ${u.username}?`,
                            content: '该用户的所有 DashScope 账户、任务、上传都将级联删除',
                            okButtonProps: { danger: true },
                            onOk: () => deleteMut.mutate(u.id),
                          })
                        }
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        title="新建用户"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        okText="创建"
        cancelText="取消"
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => createMut.mutate(v)}
          initialValues={{ isAdmin: false }}
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, pattern: /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{2,31}$/, message: '3-32 字符 / 字母数字下划线' }]}
          >
            <Input placeholder="例如: alice" autoComplete="off" />
          </Form.Item>
          <Form.Item name="displayName" label="显示名 (可选)">
            <Input placeholder="例如: Alice 王" />
          </Form.Item>
          <Form.Item
            name="password"
            label="初始密码"
            rules={[{ required: true, min: 6, message: '至少 6 位' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="isAdmin" label="管理员权限" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={resetTarget ? `重置 ${resetTarget.username} 的密码` : ''}
        open={!!resetTarget}
        onCancel={() => setResetTarget(null)}
        onOk={() => resetForm.submit()}
        confirmLoading={resetMut.isPending}
        okText="重置"
        cancelText="取消"
      >
        <Form
          form={resetForm}
          layout="vertical"
          onFinish={(v) =>
            resetTarget && resetMut.mutate({ id: resetTarget.id, newPassword: v.newPassword })
          }
        >
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[{ required: true, min: 6, message: '至少 6 位' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
