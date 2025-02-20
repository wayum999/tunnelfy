export interface CloudflareTunnel {
  id: string;
  name: string;
  created_at: string;
  deleted_at?: string;
  account_tag: string;
  connections?: Array<{
    id: string;
    connected_at: string;
    disconnected_at?: string;
    status: string;
    colo_name: string;
    uuid: string;
    is_pending_reconnect: boolean;
    origin_ip: string;
    opened_at: string;
    client_id: string;
    client_version: string;
  }>;
  conns_active_at: string | null;
  conns_inactive_at: string | null;
  tun_type: string;
  metadata: Record<string, any>;
  status: string;
  remote_config: boolean;
}
