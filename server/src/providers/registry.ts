import type { CapabilityId, IProvider, Capability } from '@bvp/shared';

const registry = new Map<CapabilityId, IProvider>();

export function registerProvider(provider: IProvider): void {
  registry.set(provider.capability.id, provider);
}

export function getProvider(id: CapabilityId): IProvider {
  const p = registry.get(id);
  if (!p) throw new Error(`Provider not found: ${id}`);
  return p;
}

export function listCapabilities(): Capability[] {
  return Array.from(registry.values()).map((p) => p.capability);
}

export function hasCapability(id: string): id is CapabilityId {
  return registry.has(id as CapabilityId);
}
