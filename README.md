# App AI Service

Cloudflare Worker that provides secure access to Anthropic's Claude API with context validation and system prompt management for LimeSpot applications.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create a `.dev.vars` file for local development (gitignored):

```bash
echo "CLAUDE_API_KEY=sk-ant-api03-your-key-here" > .dev.vars
```

Get your API key from [Anthropic Console](https://console.anthropic.com/) → API Keys.

**Note:** `.dev.vars` is gitignored and never committed. Production uses Cloudflare encrypted secrets.

### 3. Start Development Server

```bash
npm run dev
```

Server runs at `http://localhost:8787`

### 4. Test

```bash
# Health check
curl http://localhost:8787/health

# Expected response:
# {"status":"ok","message":"App AI service is running","timestamp":"..."}
```

## API Endpoints

All endpoints except `/health` require `X-Personalizer-Context-ID` header for authentication.

| Method | Endpoint      | Description            | Auth Required |
| ------ | ------------- | ---------------------- | ------------- |
| GET    | `/health`     | Health check           | No            |
| POST   | `/files`      | Upload file to Claude  | Yes           |
| GET    | `/files`      | List uploaded files    | Yes           |
| DELETE | `/files/{id}` | Delete file            | Yes           |
| POST   | `/messages`   | Send message to Claude | Yes           |

### Headers

- **`X-Personalizer-Context-ID`** (required for protected endpoints): Authentication token validated against Brain API
- **`X-Personalizer-System-Prompt`** (optional): System prompt name (e.g., "image-selection")

### Example Request

```bash
curl -X POST http://localhost:8787/messages \
  -H "Content-Type: application/json" \
  -H "X-Personalizer-Context-ID: your-context-id" \
  -H "X-Personalizer-System-Prompt: image-selection" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## Development

### Local Setup

```bash
# Start dev server
npm run dev

# Watch logs
# (logs appear in same terminal)

# Test endpoints
curl http://localhost:8787/health
```

### File Structure

```
app-ai/
├── src/
│   ├── index.js      # Main worker code
│   └── prompts.js    # System prompts
├── wrangler.toml     # Configuration (public settings)
├── .dev.vars         # Local secrets (gitignored)
└── package.json
```

### Environment Variables

**Local Development:**

- Public config in `wrangler.toml` `[env.dev.vars]` section
- Secrets in `.dev.vars` file (gitignored):
  ```bash
  CLAUDE_API_KEY=sk-ant-api03-...
  ```

**Production:**

- Public config in `wrangler.toml` `[vars]` section (default)
- Secrets set via Cloudflare Dashboard:
  - Workers > app-ai > Settings > Variables > Encrypt
  - Add `CLAUDE_API_KEY` as encrypted secret

### Updating System Prompts

System prompts are bundled in [src/prompts.js](src/prompts.js).

1. Edit `src/prompts.js`
2. Test locally: `npm run dev`
3. Commit and push to GitHub (auto-deploys to production)

### CORS Configuration

Update allowed origins in [src/index.js](src/index.js) before deploying:

```javascript
const allowedOrigins = [
  "http://localhost:4200", // Angular dev
  "https://app.limespot.com", // Production
  // Add more as needed
];
```

## Deployment

### Automated Deployment (GitHub Integration)

This project uses Cloudflare's GitHub integration for automatic deployment:

- **Commits to `main` branch** → Auto-deploy to production environment

**Setup:**

1. Connect repository to Cloudflare via dashboard
2. Configure branch-to-environment mapping (`main` → `app-ai`)
3. Set `CLAUDE_API_KEY` secret in Cloudflare Dashboard:
   - Workers > app-ai > Settings > Variables > Encrypt
   - Add secret with key `CLAUDE_API_KEY`

**No manual deployment needed** - push to GitHub and Cloudflare auto-deploys.

### Manual Deployment (Testing Only)

For testing changes before committing to GitHub:

```bash
# Test manual deploy to development environment
npm run deploy

# View logs
npm run tail
```

**Note:** Manual deployment should only be used for:

- Testing deployment process
- Emergency hotfixes
- Validating changes before pushing to GitHub

### Environments

All configured in [wrangler.toml](wrangler.toml):

- **Local** (`wrangler dev --env dev` or `npm run dev`): `http://localhost:8787`

  - Config: `wrangler.toml` `[env.dev.vars]` section
  - Secrets: `.dev.vars` file (gitignored)
  - Brain API: `https://local.personalizer.io`

- **Production** (Cloudflare auto-deploy): `https://app-ai.personalizer.io`
  - Config: `wrangler.toml` `[vars]` section (default)
  - Secrets: Cloudflare Dashboard (encrypted)
  - Brain API: `https://personalizer.io`
  - Auto-deploys from `main` branch

Each environment configuration includes:

- `ENVIRONMENT` - Environment name
- `BRAIN_API_URL` - Backend API URL
- `CLAUDE_API_KEY` - Anthropic API key

### View Live Logs

```bash
# Production logs
npm run tail
```

## Security

### Best Practices

1. **API Keys**

   - Never commit API keys to git
   - Local: Store in `.dev.vars` (gitignored)
   - Production: Use Cloudflare encrypted secrets
   - Rotate keys regularly

2. **CORS**

   - Restrict allowed origins to known domains
   - Never use `*` in production

3. **Context Validation**

   - All protected endpoints validate context ID against Brain API
   - Invalid contexts return 401/403 errors

4. **Input Validation**
   - File upload size limits enforced
   - Request payloads validated
   - Appropriate error codes returned

### Development Dependencies

Some npm audit warnings exist for development dependencies (esbuild, vite). These are:

- **Not in production** (dev-only tools)
- **Not critical** (development server vulnerabilities)
- **Mitigated** by not exposing dev server to internet

**For production:** No action needed - vulnerabilities don't affect deployed workers.

### Security Checklist

Before deploying:

- [ ] API keys set as Cloudflare encrypted secrets (not in code)
- [ ] `.dev.vars` is gitignored
- [ ] CORS origins restricted to production domains
- [ ] No sensitive data in logs
- [ ] Context validation working
- [ ] Dependencies updated

## Troubleshooting

### Port 8787 already in use

```bash
lsof -i :8787
kill -9 <PID>
```

### API key not working

- Check `.dev.vars` file exists with `CLAUDE_API_KEY`
- Verify API key starts with `sk-ant-api03-`
- Ensure no extra spaces or quotes in `.dev.vars`
- Restart dev server after changes

### CORS errors

- Verify app origin in allowed list ([src/index.js](src/index.js))
- Restart dev server after changes
- Check browser console for specific error

### Context validation failing

- Verify context ID is valid in Brain API
- Check `BRAIN_API_URL` environment variable
- Review validation logs in worker output

### Deployment issues

```bash
# Check account ID in wrangler.toml
wrangler whoami

# Verify configuration
cat wrangler.toml | grep -A3 "\[vars\]"

# Check deployment logs
wrangler tail
```

## Commands Reference

```bash
# Development
npm run dev              # Start local server (port 8787)
npm run test             # Run tests

# Deployment (Manual - for testing only)
npm run deploy           # Deploy to default environment

# Monitoring
npm run tail             # View production logs

# Maintenance
npm run update-deps      # Update dependencies and run audit fix
npm audit                # Check security
wrangler whoami          # Check authentication

# Note: Staging and production deploy automatically via GitHub integration
```

## Platform Details

### Cloudflare Workers

- **Runtime:** V8 Isolates (not Node.js)
- **APIs:** Web Standards (fetch, Request, Response, FormData)
- **Limits:** 50,000ms CPU time per request (configured in wrangler.toml)
- **Scaling:** Automatic, handles any traffic volume
- **Global:** Deployed to 300+ cities worldwide

### Performance

- **Cold start:** <1ms (V8 isolates)
- **Latency:** 10-50ms (edge deployment)
- **Throughput:** 1000+ requests/second
- **Uptime:** 99.99% SLA

### Cost

- **Free tier:** 100,000 requests/day
- **Paid:** $5/month for 10M requests
- **No infrastructure:** No servers to maintain

## Resources

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [Anthropic API Docs](https://docs.anthropic.com/)
- [Brain API](https://personalizer.io)

---

**Status:** Production Ready
**Platform:** Cloudflare Workers
**Runtime:** V8 Isolates
