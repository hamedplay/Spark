# Nginx Configuration

Nginx serves the React frontend and proxies Supabase API calls.
Coturn runs directly on its own ports — Nginx does NOT proxy WebRTC media.

---

## /etc/nginx/sites-available/meeting-app

```nginx
# HTTP → HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name YOURDOMAIN.COM www.YOURDOMAIN.COM turn.YOURDOMAIN.COM;
    return 301 https://$host$request_uri;
}

# Main application
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name YOURDOMAIN.COM www.YOURDOMAIN.COM;

    ssl_certificate     /etc/letsencrypt/live/YOURDOMAIN.COM/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/YOURDOMAIN.COM/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache   shared:SSL:10m;

    root /var/www/meeting-app/dist;
    index index.html;

    # React SPA — serve index.html for all routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets aggressively
    location ~* \.(js|css|woff2|png|jpg|svg|ico)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Security headers
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy strict-origin-when-cross-origin;
    add_header Permissions-Policy "camera=*, microphone=*, display-capture=*";

    # WebSocket support (Supabase Realtime)
    location /realtime/ {
        proxy_pass https://YOUR_SUPABASE_PROJECT_REF.supabase.co;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
    }

    client_max_body_size 50M;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
}

# TURN subdomain — Nginx only handles TLS cert renewal ACME challenges.
# Coturn handles port 5349 directly; this block is only needed if you use
# certbot --webroot for the turn subdomain.
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name turn.YOURDOMAIN.COM;

    ssl_certificate     /etc/letsencrypt/live/turn.YOURDOMAIN.COM/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/turn.YOURDOMAIN.COM/privkey.pem;

    # Health check endpoint for monitoring
    location /health {
        return 200 "TURN OK\n";
        add_header Content-Type text/plain;
    }

    location / {
        return 404;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/meeting-app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## Deploy Frontend

```bash
# On your dev machine, build and upload
npm run build
rsync -avz dist/ user@YOURSERVER:/var/www/meeting-app/dist/
```
