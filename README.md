# Brain Games for YunoHost

A lightweight, self-hosted brain games platform. It runs on Python's standard library only, with no database and no build step, and uses about 20 MB of RAM.

## Games (42)

**Daily puzzles** (you set them in the admin panel):
- **Wordle**: guess a 4–8 letter word in 6 tries (shareable emoji result)
- **Connections**: find 4 groups of 4 (shareable emoji result)
- **Word Scramble**: unscramble a list of words, with optional hints
- **Daily Riddle**: 3 guesses, with an optional hint
- **Daily Trivia**: multiple-choice questions, one try each (shareable result)
- **Hangman**: a phrase with an optional category, 6 lives
- **Word Search**: a themed word list hidden in a grid that's the same for every player that day
- **Spelling Bee**: 7 letters plus the list of words you accept, with ranks and pangrams
- **Cryptogram**: a quote in a letter-substitution code, with hints
- **Emoji Decoder**: guess films, phrases and things from emojis

**Daily, automatic:** Number Target, a Countdown-style numbers puzzle that's the same for everyone each day (with a practice mode).

**Anytime games:** Sudoku (Easy/Medium/Hard plus a shared daily grid), Minesweeper, Lights Out, Sliding Puzzle, Code Breaker, 2048, Memory Match, Math Sprint, Simon Says, Nonogram, Schulte Table, Number Memory, Color Clash (Stroop test), Tower of Hanoi Tic-Tac-Toe (unbeatable or casual AI), Connect Four (3 difficulties), Reversi, Flood It, Visual Memory, Chimp Test, Number Sequence and Odd One Out.

**Multiplayer, played on everyone's own phone:** Imposter, Spy Hunt, Trivia Race, Closest Wins, Bluff, Most Likely To, Mind Reader, Letter Blitz and Connect Four Online. One player creates a room, and friends join with the 4-letter code or an invite link. Rooms are kept in the server's memory and close after 3 hours without activity.

Anyone can play without an account; progress is then kept in their browser. Players who **create an account** (username + password) get saved stats (points, streaks, dailies solved, wins, personal bests, multiplayer record) and a place on the **global leaderboard** (top 100, accounts only). Points: 100 per daily puzzle solved (25 for trying), 10 per win in other games (max 200/day), 30 per multiplayer win or 10 per game (max 300/day). Multiplayer results are recorded by the server; single-player results are reported by the browser, so treat them as honour-system. Accounts are stored in `/home/yunohost.app/gaming_system/accounts.json`, and staff can manage them in the admin panel (see below).

## Install

```bash
sudo yunohost app install https://github.com/GZPlaz/gaming-system_ynh
```

The installer asks for a domain, a path (default `/games`) and who can access it. Then sign in as `admin` / `admin` and change it straight away (see below).

## Admin panel and staff

On first start the app creates a **super admin account: username `admin`, password `admin`**. Sign in (on the site or at `https://your.domain/games/admin.html`) **right after installing or upgrading**: you're asked to choose a new password (and optionally a new username), and no admin features work until you do. Anyone who reaches the site before you could do the same, so don't wait.

Roles (the super admin assigns them in the admin panel's **Players** tab):

| Role | Can do |
|---|---|
| **Game writer** | Create and edit daily puzzles |
| **Full admin** | Everything a game writer can, plus see players and delete player accounts |
| **Super admin** (one, the `admin` account) | Everything, plus give/take roles, ban or unban accounts, IP-ban (an account's recent addresses or any address) and use cheats in online games |

**Site settings** (🎨 Site tab, full admins and the super admin): site name, logo emoji, tagline, footer, theme colours, an announcement banner (text, style, link), which games are shown, whether sign-ups are open, whether the leaderboard is shown, and how many points each result is worth.

**Stats** (super admin): the 📊 button next to a player edits their points, streak, wins and other stats, or resets them.

Banned accounts can't sign in and disappear from the leaderboard; banned IPs can't open the site at all (manage them in the **IP bans** tab).

**Cheats:** in any online game the super admin gets a 🕶️ toggle in the room. With it on, they secretly see the imposter / secret word, the right trivia or number answer, the real Bluff answer, live Most Likely To votes, or the best Connect Four move. Spy Hunt shows the location or the spy, Mind Reader the target, and Letter Blitz everyone's answers so far. Only the super admin sees anything, and cheat wins count like any other.

Daily puzzle editing works as before: pick a date, fill in the form, save; or bulk-import JSON. If no puzzle is scheduled for today, players get a replay of an older one.

**Locked out?** Reset the super admin's password from the server:

```bash
sudo -u gaming_system BG_DATA=/home/yunohost.app/gaming_system python3 /var/www/gaming_system/server.py set-password
```

Puzzles, accounts and bans are stored in `/home/yunohost.app/gaming_system/`, which YunoHost backups include.

## Run locally (development)

```bash
cd sources && python3 server.py   # http://127.0.0.1:8095, sign in as admin / admin
```
