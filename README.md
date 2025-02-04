# Tunnelfy

Managing Cloudflare tunnels directly from a VS Code extension has never been easier. Streamline your development workflow by creating and managing permanent and quick tunnels without leaving your IDE.

## Features

### Profile Management

- Manage multiple Cloudflare profiles
- Maintain the same local secure storage of profile credentials

### Tunnel Monitoring and Control

- View all your Cloudflare tunnels with status indicators
- Start and stop tunnels
- Manage permanent and quick tunnels
- Securely access tunnel tokens for configuration
- View detailed tunnel information
- Run tunnels with persistent background operation

## Prerequisites

1. VS Code (v1.85.0 or higher)
2. [Cloudflared CLI tool installed and authenticated](#installing-cloudflare-tunnel-cloudflared-on-linux-windows-and-macos)

## Getting Started

### 1. Install the Extension

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "Tunnelfy"
4. Click Install

### 2. Create a Profile

1. Click the cloud icon in the activity bar
2. Click the + button in the Profiles section
3. Follow the prompts to set up your profile
Note: By default, a profile named "Default Profile" is created. You can edit its name by clicking on the pencil icon when hovering over it.

### 3. Managing Tunnels

1. Click the + button in the Tunnels section
2. Enter a name for your tunnel
3. Once created, you can:
   - Start and stop the tunnel
   - View tunnel information and sample configuration setups
   - Copy the tunnel token
   - Delete the tunnel

### 4. Quick Tunnels

1. Click the + button in the Quick Tunnels section
2. Configure your local service details:
   - Port number
3. Once running, you can:
   - Copy the Cloudflare-assigned hostname
   - Stop the tunnel

## Extension Commands

Several commands are accessible via the Command Palette (Ctrl+Shift+P / Cmd+Shift+P):

### Profile Management
- `Tunnelfy: Create Profile` - Create a new Cloudflare profile
- `Tunnelfy: Rename Profile` - Rename a profile
- `Tunnelfy: Switch Profile` - Switch between Cloudflare profiles
- `Tunnelfy: Delete Profile` - Delete a Cloudflare profile

### Permanent Tunnel Management
- `Tunnelfy: Create Tunnel` - Create a new permanent tunnel
- `Tunnelfy: Refresh Tunnels` - Refresh the list of tunnels
- `Tunnelfy: Start Tunnel` - Start a tunnel
- `Tunnelfy: Stop Tunnel` - Stop a tunnel
- `Tunnelfy: View Tunnel Info` - View detailed information about a tunnel
- `Tunnelfy: Copy Tunnel Token` - Copy the token of a tunnel
- `Tunnelfy: Delete Tunnel` - Delete a tunnel

### Quick Tunnel Management
- `Tunnelfy: Create Quick Tunnel` - Create a new quick tunnel
- `Tunnelfy: Copy Quick Tunnel URL` - Copy the URL of a quick tunnel
- `Tunnelfy: Stop Quick Tunnel` - Stop a quick tunnel


## Troubleshooting

### Common Issues

1. **Authentication Selection Missing After Cloudflare Login**

   **Problem:** When setting up a profile, the authentication selection may be missing after logging in to Cloudflare.

   **Solution 1:** Stay logged into Cloudflare and reattempt to create the profile. When the browser opens, you should be given a choice of which domain to associate the authentication. 

   **Solution 2:** Access the authentication link in the output of the extension. When you reopen it, you will find the listing of domains to choose from.

   **IMPORTANT NOTE:** You can only choose one domain to tie to the authentication. Regardless of your choice, you will be able to manage all tunnels in the account. The domain you choose simply allows you to modify DNS records for that domain and you can only choose one. DNS records can be modified manually for all others.
2. **Port and/or Hostname Entry Not Working**

   **Problem:** The port and/or hostname you enter when starting a persistent tunnel is not being respected.

   **Solution:** If you set up your tunnel in the Cloudflare dashboard, the hostname and the url/port you set up will be honored. The URL and hostname you set in the extension will only be respected with tunnels you have created through the extension / the cloudflared CLI.

3. **Profile Creation Failed**
   - Ensure `cloudflared` is installed and in your PATH
   - Verify you're logged in with `cloudflared tunnel login`

4. **Tunnel Status Not Updating**
   - Click the refresh button in the Tunnels view
   - Ensure your profile is properly configured
   - Check your internet connection

5. **Quick Tunnel Won't Start**
   - Verify the port isn't already in use
   - Check if your local service is running
   - Ensure you have proper permissions

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a detailed list of changes.


## Roadmap

- Integration with the Cloudflare API as an alternative method of tunnel management using an API key.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

[MIT License](LICENSE)

## Support

If you encounter any issues or have suggestions, please:
1. Check the [Troubleshooting](#troubleshooting) section
2. View the extension logs
3. Open an issue on GitHub
4. Email info@tunnelfy.com if all else fails (response time will be slow)


---

## Installing Cloudflare Tunnel CLI (`cloudflared`)

Cloudflare Tunnel CLI (`cloudflared`) allows you to securely control exposing local applications to the internet without opening firewall ports. It is an essential part of Tunnelfy functionality.

### Linux Installation
#### Debian/Ubuntu-based distributions
```bash
sudo apt update && sudo apt install -y curl
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
sudo chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/
cloudflared --version
```

#### RHEL/Fedora-based distributions
```bash
sudo dnf install -y curl
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
sudo chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/
cloudflared --version
```

#### Arch Linux-based distributions
```bash
yay -S cloudflared-bin
cloudflared --version
```

### Windows Installation
#### Using the MSI Installer
1. Download the latest **Cloudflare Tunnel client** from:
   - [Cloudflare Tunnel Download](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/)
2. Run the installer and follow the prompts.
3. Verify installation in **Command Prompt** or **PowerShell**:
```powershell
cloudflared --version
```

#### Using Chocolatey
```powershell
choco install cloudflared
cloudflared --version
```

#### Using Winget
```powershell
winget install Cloudflare.cloudflared
cloudflared --version
```

### macOS Installation (Homebrew)
```bash
brew install cloudflare/cloudflare/cloudflared
brew services start cloudflared
cloudflared --version
```
