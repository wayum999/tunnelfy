export { TunnelManager } from "./TunnelManager";
export { TunnelLogger } from "./TunnelLogger";
export { TunnelConfig, type TunnelConfigData } from "./TunnelConfig";
export {
  TunnelProcessRegistry,
  TunnelAlreadyRunningError,
  OWNED_TUNNELS_KEY,
  type OwnedTunnelRecord,
  type StopResult,
  type TunnelKind,
} from "./TunnelProcessRegistry";

// Re-export common types
export {
  type CloudflareTunnel,
  type TunnelEvent,
  type TunnelEventType,
  CloudflaredNotFoundError,
} from "./TunnelManager";
