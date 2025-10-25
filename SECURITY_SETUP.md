# Security Setup Guide

This guide explains how to securely handle private keys and secrets in the Xibe PR Review Bot.

## 🔐 Private Key Management

### Problem
- Private keys contain special characters (`+`, `/`, `=`) that cause issues in environment variables
- Hardcoded keys in source code are a security risk
- Open-source repositories should not contain secrets

### Solution
Use base64 encoding to store private keys in environment variables.

## 🛠️ Setup Instructions

### 1. Encode Your Private Key

```bash
# Run the encoding script
node scripts/encode-private-key.js path/to/your-private-key.pem
```

This will output a base64-encoded version of your private key.

### 2. Set Environment Variables

Add the encoded key to your environment:

```bash
# For local development (.env file)
GITHUB_PRIVATE_KEY_BASE64="your-base64-encoded-key-here"

# For production (platform-specific)
# Railway, Vercel, Coolify, etc.
```

### 3. Update Your Code

The bot now supports two methods:

1. **Base64 Encoded (Recommended)**:
   ```bash
   GITHUB_PRIVATE_KEY_BASE64="base64-encoded-key"
   ```

2. **Direct Key (if no special characters)**:
   ```bash
   GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
   ```

## 🔒 Security Features

### Pre-Push Hook
A security check prevents pushing hardcoded secrets to open-source repositories:

- **Windows**: `scripts/security-check.ps1`
- **Linux/Mac**: `scripts/security-check.js`

### What It Checks
- Hardcoded private keys
- API keys in source code
- Database passwords
- JWT secrets
- Other sensitive credentials

### How It Works
1. Detects if pushing to open-source repository (GitHub, GitLab, Bitbucket)
2. Scans code for secret patterns
3. Blocks push if violations found
4. Provides helpful error messages

## 📁 File Structure

```
├── bot.js                    # Main bot file (with fallback key)
├── bot-opensource.js         # Open-source version (no hardcoded keys)
├── scripts/
│   ├── security-check.js     # Security check script
│   ├── security-check.ps1    # PowerShell security check
│   └── encode-private-key.js # Key encoding utility
├── .git/hooks/
│   └── pre-push              # Git pre-push hook
└── SECURITY_SETUP.md         # This guide
```

## 🚀 Deployment

### For Production
1. Use `bot.js` with environment variables
2. Set `GITHUB_PRIVATE_KEY_BASE64` in your platform
3. Never commit the actual private key

### For Open Source
1. Use `bot-opensource.js` (no hardcoded keys)
2. Users must provide their own private key
3. Security hook prevents accidental secret commits

## 🛡️ Security Best Practices

### ✅ Do
- Use environment variables for secrets
- Base64 encode keys with special characters
- Use platform-specific secret management
- Regular key rotation
- Monitor access logs

### ❌ Don't
- Hardcode secrets in source code
- Commit private keys to version control
- Use the same key across environments
- Share keys in plain text
- Ignore security warnings

## 🔧 Troubleshooting

### "Invalid base64 private key"
- Ensure the key was encoded correctly
- Check for extra spaces or newlines
- Re-run the encoding script

### "No private key found"
- Set `GITHUB_PRIVATE_KEY_BASE64` environment variable
- Verify the variable is available to the process
- Check platform-specific environment variable settings

### "Security violations detected"
- Remove hardcoded secrets from code
- Use environment variables instead
- Check the security check output for specific issues

## 📚 Platform-Specific Guides

### Railway
1. Go to your project dashboard
2. Navigate to Variables tab
3. Add `GITHUB_PRIVATE_KEY_BASE64` with your encoded key
4. Redeploy your service

### Vercel
1. Go to your project settings
2. Navigate to Environment Variables
3. Add `GITHUB_PRIVATE_KEY_BASE64` with your encoded key
4. Redeploy your function

### Coolify
1. Go to your application settings
2. Navigate to Environment Variables
3. Add `GITHUB_PRIVATE_KEY_BASE64` with your encoded key
4. Restart your application

### Docker
```yaml
# docker-compose.yml
services:
  bot:
    environment:
      - GITHUB_PRIVATE_KEY_BASE64=${GITHUB_PRIVATE_KEY_BASE64}
```

## 🆘 Support

If you encounter issues:

1. Check the security check output
2. Verify environment variables are set
3. Test with the encoding script
4. Check platform-specific documentation
5. Review the troubleshooting section above

## 🔄 Key Rotation

To rotate your private key:

1. Generate new key in GitHub App settings
2. Encode the new key using the script
3. Update environment variables
4. Test the new key
5. Remove old key from environment

Remember to update all deployment platforms!
