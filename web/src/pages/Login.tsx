import { useState } from 'react';
import { Form, Input, Button, App as AntApp } from 'antd';
import { Sparkles, User, Lock } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api, type CurrentUser } from '../lib/api';

export default function Login({ onAuthed }: { onAuthed: (user: CurrentUser) => void }) {
  const [loading, setLoading] = useState(false);
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const location = useLocation();

  async function onFinish({ username, password }: { username: string; password: string }) {
    setLoading(true);
    try {
      const r = await api.login(username.trim(), password);
      onAuthed(r.user);
      const from = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(from, { replace: true });
    } catch (e) {
      message.error((e as Error).message || '登录失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-md"
      >
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-400">
            <Sparkles size={24} />
          </div>
          <h1 className="text-2xl font-semibold">批量素材推广平台</h1>
          <p className="text-sm text-zinc-500">DashScope · 新加坡站 · 多人协作</p>
        </div>
        <div className="surface p-6">
          <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
            <Form.Item
              name="username"
              label="用户名"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input size="large" autoFocus prefix={<User size={14} className="text-zinc-500" />} placeholder="username" />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password size="large" prefix={<Lock size={14} className="text-zinc-500" />} placeholder="password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} size="large" block>
              登录
            </Button>
          </Form>
        </div>
        <p className="mt-4 text-center text-xs text-zinc-600">
          首次启动会从环境变量 INITIAL_ADMIN_USERNAME / INITIAL_ADMIN_PASSWORD 初始化管理员
        </p>
      </motion.div>
    </div>
  );
}
