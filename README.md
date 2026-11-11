# Brain Games for YunoHost

A lightweight, self-hosted brain games platform. It runs on Python's standard library only, with no database and no build step, and uses about 20 MB of RAM.

## Games (39)

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

**Multiplayer, played on everyone's own phone:** Imposter, Trivia Race, Closest Wins, Bluff, Most Likely To and Connect Four Online. One player creates a room, and friends join with the 4-letter code or an invite link. Rooms are kept in the server's memory and close after 3 hours without activity.

Anyone can play without an account; progress is then kept in their browser. Players who **create an account** (username + password) get saved stats (points, streaks, dailies solved, wins, personal bests, multiplayer record) and a place on the **global leaderboard** (top 100, accounts only). Points: 100 per daily puzzle solved (25 for trying), 10 per win in other games (max 200/day), 30 per multiplayer win or 10 per game (max 300/day). Multiplayer results are recorded by the server; single-player results are reported by the browser, so treat them as honour-system. Accounts are stored in `/home/yunohost.app/gaming_system/accounts.json`, and the admin panel's **Players** tab can delete accounts.

## Install

```bash
sudo yunohost app install https://github.com/GZPlaz/gaming-system_ynh
```

The installer asks for a domain, a path (default `/games`), who can access it, and an **admin password**.

## Admin panel

Open `https://your.domain/games/admin.html` and log in. For each daily game you can:
- pick a date (it defaults to the next day without a puzzle) and fill in the form, then save
- click a scheduled date to edit or delete that puzzle
- bulk import many days at once as JSON (`{"2026-11-01": {...}, ...}`)

If no puzzle is scheduled for today, players get a replay of an older puzzle, so the game never shows up empty.

To change the admin password later:

```bash
sudo -u gaming_system BG_DATA=/home/yunohost.app/gaming_system python3 /var/www/gaming_system/server.py set-password
```

Puzzles are stored in `/home/yunohost.app/gaming_system/puzzles.json`, which YunoHost backups include.

## Run locally (development)

```bash
cd sources && echo mypass | python3 server.py set-password && python3 server.py   # http://127.0.0.1:8095
```
