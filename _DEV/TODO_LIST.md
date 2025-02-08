# TODO

- [ ] Quick tunnel creation

1. Ask user for a name for the quick tunnel

2. Ask user for the port number to use for the tunnel.

3. Use `cloudflared tunnel --url http:localhost:<PORT_ENTERED>`

It should NOT require a user to be logged into Cloudflare to use this.

The response will look list this: 

@start_quick_tunnel_response.txt 

4. Get Cloudflared-generated temporary subdomain URL.

5. Refresh the quick tunnel list view that will show for each item:

  - Tunneel name entered by user
  - Port entered by user
  - Cloudflared-generated URL

6. Each quick tunnel list item should have the follow icons/functions when hovering:
  - Copy the Cloudflared generated URL to the clipboard ('Copy tunnel URL')
  - Delete the tunnel (same delete icon as the delete persisten tunnel)

- [ ] Quick tunnel deleting/stopping and persistence

Because teh quick tunnel is meant to be temporary, it is OK if it stops when VS Code is closed.

The stop quick tunnel icon in the quick tunnel listing on hover should should function similarly to the stopping a persistent tunnel in that it should kill the process running it.