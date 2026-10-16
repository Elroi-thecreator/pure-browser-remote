# 1-Click Render Blueprint Deployment Guide

This guide walks you through deploying the **Pure Browser Remote** signaling relay and web viewer to [Render](https://render.com) using **Render Blueprints (Infrastructure as Code)**.

---

## 1. Prerequisites
- A free account on [Render](https://render.com)
- A [GitHub](https://github.com) or [GitLab](https://gitlab.com) account

---

## 2. Deploy via Render Blueprint (Recommended)

### Step 1: Push Code to GitHub
1. Initialize a git repository and commit your files:
   ```bash
   git init
   git add .
   git commit -m "Deploy Pure Browser Remote to Render"
   ```
2. Create a new repository on GitHub (public or private) and push your code:
   ```bash
   git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPO>.git
   git branch -M main
   git push -u origin main
   ```

### Step 2: Launch Blueprint on Render
1. Log in to [Render Dashboard](https://dashboard.render.com/).
2. In the top-right corner, click **New +** and select **Blueprint**.
3. Connect your GitHub account and select your repository.
4. Render will automatically read `render.yaml` and configure:
   - **Service Name**: `pure-browser-remote-relay`
   - **Environment**: Node
   - **Plan**: Free ($0/month)
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Health Check**: `/health`
5. Click **Apply**.
6. Render will build and deploy your service in ~60 seconds.

---

## 3. Alternative: Manual Web Service Setup (Without Git Blueprint)

If you prefer to configure manually in the Render UI:
1. In Render Dashboard, click **New + → Web Service**.
2. Connect your repo.
3. Set the following fields:
   - **Name**: `pure-browser-remote-relay`
   - **Root Directory**: `pure-browser-remote/signaling-server` (or leave blank if repository is just the signaling server)
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: `Free`
4. Expand **Advanced**:
   - Set **Health Check Path** to `/health`
5. Click **Create Web Service**.

---

## 4. How to Use Your Deployed Service

Once deployed, Render provides an HTTPS URL:
`https://pure-browser-remote-relay.onrender.com`

### 1. In the Host Chrome Extension (`host.html`)
- Open the Host Control Center.
- In the **Signaling WebSocket URL** box, enter your Render WebSocket URL (replace `https://` with `wss://`):
  ```text
  wss://pure-browser-remote-relay.onrender.com
  ```
- The extension automatically remembers this URL for all future sessions!
- Click **🎥 Share Screen / Tab** and **🚀 Start Hosting**.

### 2. In Any Remote Viewer (Phone / Laptop)
- Simply visit:
  ```text
  https://pure-browser-remote-relay.onrender.com
  ```
- Enter your 6-digit Room PIN and start controlling the remote host!

### 3. Zero-Install Web Page Host (For Locked-Down Machines)
- On any locked-down PC where extensions are blocked, visit:
  ```text
  https://pure-browser-remote-relay.onrender.com/host
  ```
- Click **🎥 Share Screen & Start Hosting** to stream without installing anything.
