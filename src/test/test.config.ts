export const testConfig = {
    // Test timeouts
    defaultTimeout: 10000, // 10 seconds
    
    // Mock data
    mockTunnelId: 'test-tunnel-123',
    mockTunnelName: 'test-tunnel',
    mockProfileName: 'test-profile',
    
    // Test ports
    testPort: 8080,
    
    // Test paths
    testConfigPath: '.cloudflared/config.yml',
    testCredentialsPath: '.cloudflared/cert.pem',
    
    // Mock responses
    mockTunnelResponse: {
        id: 'test-tunnel-123',
        name: 'test-tunnel',
        created_at: '2025-01-29T12:00:00Z',
        connections: [],
        status: 'active'
    }
};
