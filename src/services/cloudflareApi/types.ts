/**
 * Types and interfaces for Cloudflare API interactions
 */

/**
 * Interface representing a Cloudflare tunnel's data structure
 * Matches the API response format from Cloudflare
 */
export interface CloudflareTunnel {
    /** Unique identifier for the tunnel */
    id: string;
    /** User-defined name for the tunnel */
    name: string;
    /** Timestamp when the tunnel was created */
    created_at: string;
    /** Timestamp when the tunnel was deleted (if applicable) */
    deleted_at?: string;
    /** Account identifier tag */
    account_tag: string;
    /** Array of active connections for this tunnel */
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
    /** Timestamp of last active connection */
    conns_active_at: string | null;
    /** Timestamp of last inactive connection */
    conns_inactive_at: string | null;
    /** Type of tunnel */
    tun_type: string;
    /** Additional metadata */
    metadata: Record<string, any>;
    /** Current tunnel status */
    status: string;
    /** Whether the tunnel uses remote configuration */
    remote_config: boolean;
    /** Whether the tunnel is running locally */
    is_running_locally?: boolean;
    /** The management type of the tunnel */
    management_type?: 'remote' | 'local';
}

/**
 * Interface representing a Cloudflare account
 * Contains account details and settings
 */
export interface CloudflareAccount {
    /** Unique identifier for the account */
    id: string;
    /** Account name */
    name: string;
    /** Type of account */
    type: string;
    /** Account settings */
    settings: {
        /** Whether two-factor authentication is required */
        enforce_twofactor: boolean;
        /** Whether API access is enabled */
        api_access_enabled: boolean | null;
        /** Expiry time for access approval */
        access_approval_expiry: string | null;
        /** Whether to use account custom nameservers by default */
        use_account_custom_ns_by_default: boolean;
        /** Default nameservers */
        default_nameservers: string;
        /** Email for abuse reports */
        abuse_contact_email: string | null;
    };
    /** Account creation timestamp */
    created_on: string;
}

/**
 * Interface for DNS record information
 */
export interface DnsRecord {
    id: string;
    name: string;
    type: string;
    content: string;
}

/**
 * Interface for zone information
 */
export interface Zone {
    id: string;
    name: string;
}

/**
 * Interface for CNAME conflict check results
 */
export interface CnameConflictResult {
    isPointingElsewhere: boolean;
    existingRecord?: {
        id: string;
        content: string;
    };
    tunnelInUse?: {
        recordId: string;
        recordName: string;
    };
}

/**
 * Interface for API response structure
 */
export interface CloudflareApiResponse<T> {
    success: boolean;
    errors?: Array<{ message: string }>;
    result: T;
} 