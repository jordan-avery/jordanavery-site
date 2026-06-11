---
title: 'Spicy UNO'
description: 'Real-time multiplayer UNO in the browser, built around the house rules my friends and I have played for years.'
category: 'builds'
status: 'in-progress'
pubDate: '2026-05-21'
updatedDate: '2026-06-10'
tags: ['typescript', 'react', 'realtime', 'socket.io', 'side-project']
featured: true
demoUrl: 'https://jordanavery.dev/projects/uno/'
---

## What it is

Real-time multiplayer UNO, built around the house ruleset my friends and I have played in person for years. Share a room code, open in a browser — nothing to install.

![Spicy UNO login screen](/projects/uno/screen-login.png)

## How a game works

The host creates a room and shares a code. Everyone joins, enters a name, and the host kicks off the deal. From there it's turn-based play over a live socket connection — cards played by one player appear on everyone's screen immediately.

## Functionality

### Blind starting hand

![Choosing a pile at game start](/projects/uno/screen-pile-select.png)

At the start of each game, cards are dealt into face-down piles. Each player picks one without knowing what's inside. The randomness starts before the first card is played.

### Eligible cards lift automatically

![Game board with eligible cards highlighted](/projects/uno/screen-gameboard.png)

Cards you can legally play are lifted and brightened. You see your options immediately without scanning your whole hand.

### Two sort modes

**Color → #** and **# → Color** sort your hand in one tap, either grouping by color or by number. Useful for different decision styles — staying in one color vs. planning number runs.

### Ask for help

![Ask for help modal](/projects/uno/screen-ask-help.png)

If you're stuck, you can broadcast a help request to the table. Other players can offer a card from their hand — you decide whether to take it or draw from the deck instead.

## Stack

- **Frontend:** React + TypeScript, served via Astro
- **Realtime:** Socket.io
- **Backend:** Node.js on Render
- **Hosting:** Cloudflare Pages
