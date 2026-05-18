# Hamro CSIT Question Bank Scraper

A Node.js tool to scrape, organize, and intelligently categorize exam questions and syllabi from [hamrocsit.com](https://hamrocsit.com) using web automation and AI.

## Table of Contents

- [Quick Start](#quick-start)
- [Complete Setup Guide](#complete-setup-guide)
  - [Prerequisites](#prerequisites)
  - [Step 1: Clone and Install](#step-1-clone-and-install)
  - [Step 2: Install Chromium](#step-2-install-chromium)
  - [Step 3: Install and Login to Gemini CLI](#step-3-install-and-login-to-gemini-cli)
- [How to Use](#how-to-use)
  - [Running the Script](#running-the-script)
  - [Option 1: Scrape Question Banks Only](#option-1-scrape-question-banks-only)
  - [Option 2: Scrape Syllabus Only](#option-2-scrape-syllabus-only)
  - [Option 3: Scrape Both (Recommended)](#option-3-scrape-both-recommended)
  - [Option 4: Organize Questions with AI](#option-4-organize-questions-with-ai)
- [Understanding Your Output](#understanding-your-output)
  - [Question Bank Files](#question-bank-files)
  - [Syllabus Files](#syllabus-files)
  - [Organized Files (AI-generated)](#organized-files-ai-generated)
  - [Directory Structure](#directory-structure)
- [Troubleshooting](#troubleshooting)
  - [Installation Issues](#installation-issues)
  - [Scraping Issues](#scraping-issues)
  - [Gemini CLI Issues](#gemini-cli-issues)
- [Features](#features)
- [How It Works](#how-it-works)
- [Performance](#performance)
- [Limitations](#limitations)
- [Contributing](#contributing)
- [License](#license)

## Features

- Automatically scrape hamrocsit.com
- Auto-detect question years and mark model questions
- Extract course units and topics
- Use Gemini AI to organize questions by topic
- Clean markdown output
- Process entire semesters at once

---

## Quick Start

1. **Install Node.js v18+** from https://nodejs.org/
2. **Clone and setup:**
   ```bash
   git clone https://github.com/yourusername/hamro-csit-question-bank-scraper.git
   cd hamro-csit-question-bank-scraper
   npm install && npx playwright install chromium
   ```
3. **Install Gemini CLI:**
   ```bash
   brew install gemini-cli    # macOS
   sudo apt install gemini-cli # Linux
   ```
4. **Login to Gemini:**
   ```bash
   gemini
   ```
   (Follow on-screen prompts)

5. **Run the script:**
   ```bash
   node start-scraping.js
   ```

Done! Files will be saved to `output/seventh/` (or chosen semester).

---

## Features

- **Web Scraping**: Automatically fetch question banks and syllabi for any semester (1-8)
- **Question Extraction**: Extract exam questions from multiple years with automatic year detection
- **Syllabus Parsing**: Extract course metadata, units, topics, lab works, and textbooks
- **AI Organization**: Use Gemini AI to automatically map questions to syllabus units and topics
- **Markdown Output**: Generate well-formatted markdown files organized by semester and subject

## Prerequisites

- Node.js (v18+)
- npm
- Playwright (installed via npm)
- Gemini CLI (for AI organization feature)

---

## Complete Setup Guide

Follow these steps in order. You only need to do this once.

### Prerequisites

Check that you have:

- **Node.js** v18+ ([Download](https://nodejs.org/))
- **npm** (comes with Node.js)
- **Git** (to clone repository)
- **Web browser** (for Gemini login)

Verify versions:
```bash
node --version    # Should show v18+
npm --version
```

### Step 1: Clone and Install

```bash
git clone https://github.com/yourusername/hamro-csit-question-bank-scraper.git
cd hamro-csit-question-bank-scraper
npm install
```

This installs Playwright, readline, and other dependencies.

### Step 2: Install Chromium

Playwright needs Chromium for web scraping:

```bash
npx playwright install chromium
```

Downloads ~300MB. One-time only. Takes 1-2 minutes.

### Step 3: Install and Login to Gemini CLI

**Install:**

```bash
# macOS
brew install gemini-cli

# Linux
sudo apt install gemini-cli
```

Or follow the [official Gemini CLI installation guide](https://geminicli.com/docs/get-started/installation/)

**Login:**

Before using option 4 (AI organization), authenticate:

```bash
gemini
```

Follow prompts:
1. Approve login in browser
2. Sign in with Google
3. Allow Gemini CLI access
4. Return to terminal

> Token is cached. Only login once.

**Verify:**
```bash
gemini --version
```

---

---

## How to Use

### Running the Script

```bash
node start-scraping.js
```

You'll be prompted for:

1. **Semester number (1-8):** Enter `7` for 7th semester
2. **What to do (1-5):** Choose from options below

---

### Option 1: Scrape Question Banks Only

Gets exam questions from all years.

```bash
Enter choice (1-5): 1
```

**What it does:**
- Finds all question papers for each subject
- Extracts questions (newest year first)
- Marks model questions
- Saves to `output/seventh/question-banks/`

**Time:** ~1-2 minutes per subject

**Output example:**
```markdown
# Advanced Java
**Semester:** 7 | **Generated:** 5/18/2026

### Year: 2081
1. Explain inheritance in Java
2. What is polymorphism?

### Year: 2080 **[MODEL QUESTION]**
1. Define encapsulation
```

---

### Option 2: Scrape Syllabus Only

Gets course syllabi with units and topics.

```bash
Enter choice (1-5): 2
```

**What it does:**
- Extracts course information
- Gets all units and topics
- Collects lab works
- Saves reference books
- Saves to `output/seventh/syllabus/`

**Time:** ~1-2 minutes per subject

**Output includes:**
- Course title, code, marks, credits
- Units with descriptions
- Laboratory works
- Text books and references

---

### Option 3: Scrape Both (Recommended)

Gets question banks AND syllabi at once. **Start here!**

```bash
Enter choice (1-5): 3
```

**What it does:**
- Combines options 1 and 2
- Processes all subjects in semester
- Creates both question-banks and syllabus directories

**Time:** 15-30 minutes per semester

**After this, you can use option 4.**

---

### Option 4: Organize Questions with AI

Uses Gemini to map questions to syllabus topics.

```bash
Enter choice (1-5): 4
```

**Prerequisites:**
- Already ran option 3 (or have both question-banks and syllabus)
- Logged in to Gemini: `gemini`

**What it does:**
- Reads question and syllabus files
- Sends to Gemini AI with detailed instructions
- Gemini maps each question to topics
- Creates organized markdown tables
- Saves to `output/seventh/organized/`

**Time:** 2-5 minutes per subject

**Output example:**
```markdown
# advanced-java — Organized by Syllabus Unit

## Unit 1: OOP Concepts

### 1.1 Classes and Objects

| Q# | Year | Question | Topic |
|---|---|---|---|
| Q1 | 2081 | What is a class? | 1.1 Classes and Objects |
| Q2 | 2080 | Define object. | 1.1 Classes and Objects |
```

**Not working?**
- Make sure you're logged in: `gemini`
- Check files exist: `ls output/seventh/question-banks/`
- Both directories needed for same subjects

---

## Understanding Your Output

After running the script, you'll have markdown files. Here's what they contain.

### Directory Structure

After running the script, your `output/` folder looks like:

```
output/
├── seventh/                    # For semester 7
│   ├── question-banks/         # Raw questions (from option 1 or 3)
│   │   ├── advanced-java.md
│   │   ├── data-mining.md
│   │   └── ...
│   ├── syllabus/               # Raw syllabi (from option 2 or 3)
│   │   ├── advanced-java.md
│   │   ├── data-mining.md
│   │   └── ...
│   └── organized/              # AI-organized (from option 4)
│       ├── advanced-java.md
│       ├── data-mining.md
│       └── ...
```

Each subject gets its own `.md` file. All plain text, easy to read.

### Question Bank Files

**Location:** `output/seventh/question-banks/advanced-java.md`

**Contains:**
- Questions from all years
- Sorted by year (newest first)
- Model questions marked
- Exact question text

**Example:**
```markdown
# Advanced Java
**Semester:** 7 | **Generated:** 5/18/2026, 2:25:21 PM

## Question Banks

Sorted by year (newest first). Model questions marked with **[MODEL QUESTION]**.

### Year: 2081
**Label:** Advanced Java 2081
**URL:** https://hamrocsit.com/...

1. Explain the concepts of inheritance in Java.
2. What is method overriding?
3. Define polymorphism.

### Year: 2080 **[MODEL QUESTION]**
**Label:** Advanced Java Model 2080

1. Explain abstraction in OOP.
2. How do you implement an interface in Java?
```

---

### Syllabus Files

**Location:** `output/seventh/syllabus/advanced-java.md`

**Contains:**
- Course metadata (title, code, marks, credits)
- Units with topics
- Lab works
- References

**Example:**
```markdown
# Advanced Java
**Semester:** 7 | **Generated:** 5/18/2026, 2:25:38 PM

## Syllabus

### Course Information

- **Course Title:** Advanced Java Programming
- **Course no:** CSC407
- **Full Marks:** 60+20+20
- **Credit Hours:** 3

### Course Contents

#### Unit 1. Object-Oriented Programming Concepts
4 Hrs.

Introduction to OOP, classes, objects, encapsulation, inheritance...

#### Unit 2. Exception Handling
3 Hrs.

Try-catch blocks, custom exceptions, exception propagation...

### Laboratory Works

Students should practice:
- Writing multi-threaded programs
- Creating custom exceptions
- Implementing design patterns

### Text Books

- Effective Java by Joshua Bloch

### Reference Books

- The Java Programming Language
- Java Concurrency in Practice
```

---

### Organized Files (AI-generated)

**Location:** `output/seventh/organized/advanced-java.md`

**Contains:**
- Questions organized by unit and topic
- Tables with Q#, Year, Question, and Topic
- Sorted by year (newest first)

**Example:**
```markdown
# advanced-java — Organized by Syllabus Unit
**Semester:** 7 | **Generated:** 5/18/2026, 3:05:25 PM

## Unit 1: Object-Oriented Programming Concepts

### 1.1 Classes and Objects

| Q# | Year | Question | Topic |
|---|---|---|---|
| Q1 | 2081 | What is a class? How does it differ from an object? | 1.1 Classes and Objects |
| Q2 | 2080 | Explain encapsulation with an example. | 1.1 Classes and Objects |

### 1.2 Inheritance

| Q# | Year | Question | Topic |
|---|---|---|---|
| Q3 | 2081 | Explain the concepts of inheritance in Java. | 1.2 Inheritance |
| Q4 | 2080 | What is method overriding? | 1.2 Inheritance |

## Unit 2: Exception Handling

### 2.1 Try-Catch Mechanism

| Q# | Year | Question | Topic |
|---|---|---|---|
| Q5 | 2081 | How does try-catch work? | 2.1 Try-Catch Mechanism |
```

---

---

## Troubleshooting

Solutions for common problems.

### Installation Issues

**"Node.js not found"**
```bash
# Install from https://nodejs.org/
node --version   # Verify v18+
```

**"npm install fails"**
```bash
npm cache clean --force
npm install
```

**"gemini: command not found"**
```bash
# macOS
brew install gemini-cli

# Linux
sudo apt install gemini-cli
```

---

### Scraping Issues

**"No subjects found"**
- Check internet: `ping hamrocsit.com`
- Verify semester is 1-8
- Website may be down

**Timeout or network errors**
- Edit script: change `timeout: 25000` to `timeout: 60000`
- Check internet speed
- Try different time

**Few/no questions extracted**
- Visit hamrocsit.com to verify questions exist
- Website structure may have changed

---

### Gemini CLI Issues

**"You must provide a message or a command"**
- You're not logged in
- Run: `gemini`
- Complete authentication

**Option 4 produces empty files**
1. Verify login: `gemini`
2. Check files: `ls output/seventh/question-banks/`
3. Make sure both question-banks and syllabus exist
4. Try again

**"Rate limit" or "quota exceeded"**
- Gemini free tier has limits
- Wait an hour

---

## Configuration

### Gemini CLI Authentication

**Required for Option 4 (Organize Questions)**

Make sure Gemini CLI is authenticated before running option 4:

```bash
gemini
```

If you haven't logged in yet, this command will guide you through authentication. You need to:
1. Approve the login request in your browser
2. Authenticate with your Google account
3. Allow Gemini CLI to access your account

Once authenticated, the token is cached locally and you won't need to login again.

### Environment Variables

None required for basic scraping. For AI organization, Gemini CLI handles authentication automatically if you're logged in.

## How It Works

### Question Bank Scraping

1. **Discovery**: Visits hamrocsit.com index page to find all subjects
2. **Indexing**: For each subject, finds all question paper links
3. **Extraction**: Extracts questions from JavaScript data (with DOM fallback)
4. **Processing**: Detects years, marks model questions, sorts by date
5. **Output**: Saves as markdown to `question-banks/`

### Syllabus Scraping

1. **Navigation**: Visits course syllabus page
2. **Parsing**: Extracts course structure from HTML
3. **Processing**: Organizes into units and topics
4. **Collection**: Gathers lab works and references
5. **Output**: Saves as markdown to `syllabus/`

### AI Organization

1. **Reading**: Loads both question bank and syllabus files
2. **Prompting**: Sends both to Gemini with detailed mapping instructions
3. **Mapping**: Gemini analyzes and assigns questions to topics
4. **Generation**: Creates organized markdown tables
5. **Output**: Saves to `organized/`

---

## Performance

| Task | Time |
|------|------|
| Initial setup | 2-5 sec |
| Per subject (questions) | 1-2 min |
| Per subject (syllabus) | 1-2 min |
| Full semester (both) | 15-30 min |
| AI organization/subject | 2-5 min |

(Times vary by internet speed and server load)

---

## Limitations

- **Site-dependent**: Works only for hamrocsit.com
- **Internet required**: Must have stable connection
- **Rate limiting**: Rapid repeated scrapes may get blocked
- **AI quality**: Depends on question clarity
- **Gemini limits**: Free tier has usage quotas
- **Semesters only**: Semesters 1-8 only

---

---

## Contributing

Ideas for improvements:

- Support other websites/institutions
- Export to JSON, CSV, PDF
- Caching to avoid re-scraping
- Better error recovery
- More output formats

---

## License

MIT

---

**Questions?** Check the [Troubleshooting](#troubleshooting) section or review the script code comments.
