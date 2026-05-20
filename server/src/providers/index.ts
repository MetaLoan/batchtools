import { registerProvider } from './registry.js';
import { qwenT2IProvider } from './dashscope/qwen-t2i.js';
import { wan27T2VProvider } from './dashscope/wan-2.7-t2v.js';
import { wan26I2VProvider } from './dashscope/wan-2.6-i2v.js';
import { wan27I2VProvider } from './dashscope/wan-2.7-i2v.js';
import { wan26R2VProvider } from './dashscope/wan-2.6-r2v.js';
import { wan27R2VProvider } from './dashscope/wan-2.7-r2v.js';

export function registerAllProviders(): void {
  registerProvider(qwenT2IProvider);
  registerProvider(wan27T2VProvider);
  registerProvider(wan26I2VProvider);
  registerProvider(wan27I2VProvider);
  registerProvider(wan26R2VProvider);
  registerProvider(wan27R2VProvider);
}

export { getProvider, listCapabilities, hasCapability } from './registry.js';
