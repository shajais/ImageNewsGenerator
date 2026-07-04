---
title: Shashi Face Swap
emoji: 🎭
colorFrom: purple
colorTo: pink
sdk: gradio
sdk_version: "4.36.1"
app_file: app.py
pinned: false
license: apache-2.0
---

# 🎬 Shashi Face Swap Studio
GPU-powered face swap (photo + video) with background replacement.  
Part of [Shashi Creator Studio](https://shajais.github.io/ShashiNewsGen).

---

## 🚀 One-Time Setup (do this once)

### Step 1 — Create the HuggingFace Space

1. Go to **https://huggingface.co/spaces**
2. Click **Create new Space**
3. Fill in:
   - **Owner:** `shajais`
   - **Space name:** `FaceSwap`
   - **SDK:** `Gradio`
   - **Hardware:** `T4 small` (free GPU)
   - **Visibility:** Public
4. Click **Create Space** — it creates an empty git repo at:  
   `https://huggingface.co/spaces/shajais/FaceSwap`

### Step 2 — Get a HuggingFace token

1. Go to **https://huggingface.co/settings/tokens**
2. Click **New token** → Role: **Write** → copy it

### Step 3 — Add token to GitHub Secrets

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `HF_TOKEN`
4. Value: paste the token from Step 2
5. Click **Add secret**

### Done! ✅

From now on, every time you `git push` to `new-improved-version` and any file inside `hf_space/` changes, GitHub Actions will **automatically sync** this folder to your HuggingFace Space. The Space redeploys in ~2 minutes.

---

## Manual first push (bootstrap)

If the Space is brand new and empty, you need to push once manually:

```bash
# Run this once from the repo root on your PC
git clone https://huggingface.co/spaces/shajais/FaceSwap hf_clone
cp -r hf_space/. hf_clone/
cd hf_clone
git add -A
git commit -m "Initial deploy"
git push
```

You'll be asked for your HuggingFace username and token as the password.

---

## How it works

```
Your PC  →  git push  →  GitHub (ShashiNewsGen)
                              ↓  (GitHub Actions: sync-hf-space.yml)
                         HuggingFace Space (shajais/FaceSwap)
                              ↓  auto-redeploys in ~2 min
                         Live GPU API  ←  app.js fetches results
```
