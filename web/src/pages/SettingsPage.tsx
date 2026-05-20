import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, Form, Input, App as AntApp, Switch, Empty, Tag, Tooltip, Tabs } from 'antd';
import { Trash2, KeyRound, UserPlus, ShieldCheck, ShieldOff } from 'lucide-react';
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
          {currentUser?.isAdmin ? '管理你的密码与全平台用户' : '管理你的密码'}
        </p>
      </div>
      <Tabs
        items={[
          { key: 'password', label: '修改密码', children: <ChangePasswordTab /> },
          ...(currentUser?.isAdmin
            ? [{ key: 'users', label: '用户管理', children: <UsersTab /> }]
            : []),
        ]}
      />
      <p className="mt-6 text-xs text-zinc-600">
        💡 DashScope API Key 由开发/运维统一在 <code className="rounded bg-zinc-800 px-1 py-0.5">accounts.yaml</code> 配置，前端不可见、不可改。如需新增或修改，联系运维。
      </p>
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
          创建团队成员账号。每个用户的任务、上传相互不可见；DashScope 账户全员共用。
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
                    {isSelf && <Tag bordered={false}>你</Tag>}
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
                            content: '该用户的所有任务、上传都将级联删除（DashScope 账户保留）',
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
