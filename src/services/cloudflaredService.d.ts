import * as vscode from 'vscode';
import * as cp from 'child_process';
export declare class CloudflaredService {
    private context;
    private readonly cloudflaredDir;
    private readonly logger;
    constructor(context: vscode.ExtensionContext);
    private get certPath();
    private verifyCertFile;
    private runCloudflaredCommand;
    checkInstallation(): Promise<boolean>;
    login(): Promise<boolean>;
    createTunnel(name: string): Promise<boolean>;
    deleteTunnel(tunnelId: string): Promise<boolean>;
    listTunnels(): Promise<any[]>;
    routeTunnel(tunnelId: string, hostname: string): Promise<boolean>;
    runTunnel(tunnelId: string, config: string): Promise<cp.ChildProcess>;
    getTunnelToken(tunnelId: string): Promise<string | null>;
    stopTunnel(tunnelId: string): Promise<boolean>;
    getTunnelInfo(tunnelId: string): Promise<any>;
    checkTunnelStatus(tunnelId: string): Promise<boolean>;
    cleanupTunnels(): Promise<void>;
    createQuickTunnel(port: number, hostname?: string): Promise<{
        url: string;
        tunnelUrl: string;
    } | null>;
    stopQuickTunnel(port: number): Promise<boolean>;
}
