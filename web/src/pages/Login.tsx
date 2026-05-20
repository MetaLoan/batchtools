import { useState } from 'react';
import { Form, Input, Button, App as AntApp } from 'antd';
import { Sparkles } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../lib/api';

export default function Login({ onAuthed }: { onAuthed: () => void }) {
  const [loading, setLoading] = useState(false);
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const location = useLocation();

  async function onFinish({ password }: { password: string }) {
    setLoading(true);
    try {
      await api.login(password);
      onAuthed();
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
          <p className="text-sm text-zinc-500">DashScope · 新加坡站 · 个人/小团队工具</p>
        </div>
        <div className="surface p-6">
          <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
            <Form.Item
              name="password"
              label="访问密码"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password size="large" autoFocus placeholder="APP_PASSWORD" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} size="large" block>
              登录
            </Button>
          </Form>
        </div>
        <p className="mt-4 text-center text-xs text-zinc-600">
          首次使用请通过环境变量 APP_PASSWORD 配置密码
        </p>
      </motion.div>
    </div>
  );
}
