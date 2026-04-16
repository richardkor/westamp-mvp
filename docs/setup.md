# WeStamp — Local Setup Guide

This guide walks you through setting up the WeStamp project on your computer.
Written for someone with no coding experience. Follow each step exactly.

Last updated: 2026-03-21

---

## What You Need to Install

Before the project can run on your machine, you need these tools.
Think of them as apps that run in the background to make the project work.

| Tool | What it does | Cost |
|---|---|---|
| Node.js | Runs the application code. Like the engine of the car. | Free |
| npm | Comes with Node.js. Downloads code libraries (tools our code depends on). Like an app store for code packages. | Free |
| Git | Tracks every change to the code. Like "track changes" in Word, but for an entire project. | Free |
| PostgreSQL | The database. Stores user accounts, agreements, and transaction data on your machine during development. | Free |
| VS Code | The code editor. Where you read and approve code. | Free |
| Terminal | The text-based window where you type commands. Already on your Mac (search for "Terminal" in Spotlight). | Built in |

---

## Step-by-Step Installation

### Step 1: Install Node.js

**What:** Node.js is what runs our application.

**Command to run (in Terminal):**
```
N/A — download from website
```

**What to do:**
1. Go to https://nodejs.org
2. Download the LTS (Long Term Support) version — this is the stable one
3. Open the downloaded file and follow the installer
4. When done, open Terminal and type: `node --version`

**What you should see:**
Something like `v22.x.x` (the exact number may differ, as long as it starts with v18 or higher)

**Common errors:**
- "command not found" → the installer didn't finish; try restarting Terminal
- Very old version number → you may have had an old Node.js; uninstall it first and reinstall

---

### Step 2: Verify npm

**What:** npm comes with Node.js. Just verify it's there.

**Command to run (in Terminal):**
```
npm --version
```

**What you should see:**
A version number like `10.x.x`

---

### Step 3: Install Git

**What:** Git tracks code changes. On Mac, it may already be installed.

**Command to run (in Terminal):**
```
git --version
```

**What you should see:**
A version number like `git version 2.x.x`

**If it says "command not found":**
- Mac will prompt you to install Xcode Command Line Tools — say yes
- Or download Git from https://git-scm.com

---

### Step 4: Install PostgreSQL

**What:** The database that stores all the data locally during development.

**Recommended approach for Mac:**
1. Download Postgres.app from https://postgresapp.com
2. Open it, click "Initialize" to create a database server
3. It will run in your menu bar (top of screen, small elephant icon)

**How to verify:**
```
psql --version
```

**What you should see:**
Something like `psql (PostgreSQL) 16.x`

**Common errors:**
- "command not found" → you may need to add Postgres.app to your PATH. Postgres.app has instructions for this on their website.

---

### Step 5: Install VS Code

**What:** The editor where you'll look at the code.

1. Go to https://code.visualstudio.com
2. Download and install
3. Open it — you should see a welcome screen

No command-line verification needed.

---

### Step 6: Clone the Project (After Scaffolding)

This step happens after we create the initial project files. Instructions will be provided at that time.

---

## How to Run the Project (After Setup)

These instructions will be filled in once the project is scaffolded.

**Start the development server:**
```
(to be filled in)
```

**Start the database:**
```
(to be filled in)
```

**Open the app in your browser:**
```
(to be filled in)
```

---

## Environment Variables

Environment variables are secret settings (like passwords and API keys) that the app needs but that should never be shared publicly.

We will create a file called `.env.local` in the project root. This file is never uploaded to the internet (Git is configured to ignore it).

The required variables will be documented here once we set them up:

```
(to be filled in)
```
