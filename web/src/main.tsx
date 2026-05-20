import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, theme, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#6366f1',
          colorBgBase: '#09090b',
          colorBgContainer: '#18181b',
          colorBgElevated: '#27272a',
          colorBorder: '#27272a',
          colorBorderSecondary: '#1f1f23',
          borderRadius: 10,
          fontFamily:
            'Inter, "HarmonyOS Sans", "Source Han Sans SC", -apple-system, BlinkMacSystemFont, sans-serif',
        },
        components: {
          Layout: {
            siderBg: '#09090b',
            headerBg: '#09090b',
            bodyBg: '#09090b',
          },
          Menu: {
            darkItemBg: '#09090b',
            darkSubMenuItemBg: '#09090b',
            darkItemSelectedBg: 'rgba(99,102,241,0.18)',
          },
        },
      }}
    >
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
);
