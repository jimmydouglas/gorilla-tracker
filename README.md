# Gorilla Tracker

Your personal fitness tracking app. Photo food logging, macro tracking, sleep & workout logging.

## Deploy to Vercel

### Step 1 — Push to GitHub
1. Create a new repo on GitHub called `gorilla-tracker`
2. Upload all these files to it (or use git)

### Step 2 — Deploy on Vercel
1. Go to vercel.com and click "Add New Project"
2. Import your `gorilla-tracker` GitHub repo
3. Vercel will auto-detect it as a Vite project
4. Before deploying, add your environment variable:
   - Key: `ANTHROPIC_API_KEY`
   - Value: your Anthropic API key from console.anthropic.com
5. Click Deploy

### Step 3 — Add to iPhone home screen
1. Open the Vercel URL in Safari
2. Tap the Share button
3. Tap "Add to Home Screen"
4. Name it "Gorilla Tracker"

That's it. Works like a native app.

## Local Development
```
npm install
npm run dev
```
