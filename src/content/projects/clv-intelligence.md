---
title: 'CLV Intelligence'
description: 'Customer Lifetime Value modelling across CRM, GA4, and paid media — BG/NBD + Gamma-Gamma with a live ECharts dashboard and authenticated upload flow.'
category: 'analytics'
status: 'in-progress'
pubDate: '2026-06-15'
tags: ['python', 'fastapi', 'react', 'echarts', 'clv', 'analytics']
featured: true
demoUrl: 'https://clv-intelligence.onrender.com'
---

## What it is

A portfolio analytics project demonstrating Customer Lifetime Value modelling
across CRM transactions, GA4 web behaviour, and paid media data. The public
demo runs on 6,538 synthetic customers — authenticated users can upload their
own data and get a personalised report.

## Live demo

The dashboard at [clv-intelligence.onrender.com](https://clv-intelligence.onrender.com) runs the full
pipeline on synthetic data: 3.5 years of transactions, realistic channel mix, and
correlated GA4 engagement signals.

## How the model works

**BG/NBD (Buy Till You Die)** models each customer's latent "alive/churned"
state from their purchase history — frequency, recency, and time since first
purchase. This is the part historic-spend metrics miss: a customer who bought
once three years ago and one who bought once last month look identical in a
simple RFM table, but have very different p(alive).

**Gamma-Gamma** then predicts expected order value from the distribution of
each customer's repeat transactions. Combining both gives a forward-looking CLV
that accounts for both how often someone will buy *and* how much they'll spend.

## Segmentation

Four operational tiers using percentile-based thresholds (not k-means):

| Segment | Threshold | Recommended action |
|---|---|---|
| High potential | Top 15% | Concierge service, max ad budget |
| Loyal | 15–45% | Priority support, upsell opportunity |
| At risk | 45–70% | Win-back email, soft discount |
| Low value | Bottom 30% | Self-serve, low-cost nurture |

Thresholds are configurable in `engine.py`.

## Data sources

The model degrades gracefully — CRM alone produces full CLV scores. Each
additional source enriches it:

- **CRM (required):** transaction history — customer ID, date, order value
- **GA4 (optional):** aggregated session signals add an engagement score (+15% CLV lift max)
- **Media spend (optional):** unlocks the CLV:CAC matrix by channel
- **Customer profiles (optional):** demographic/firmographic enrichment

Column aliases are automatically resolved — `revenue`, `amount`, `gmv`, and
`total` all map to `order_value`.

## Authenticated upload

Users request access via a form (name, email, company). I get a Discord
notification, manually add a passcode to `allowlist.json`, and reply with
the code. The token is valid for 24 hours and scoped to their session's
uploaded files.

## Stack

- **Model:** Python · `lifetimes` (BG/NBD + Gamma-Gamma) · `scikit-learn`
- **API:** FastAPI on Render · serves the React frontend as static files
- **Frontend:** React 18 · Vite · Tailwind CSS · ECharts (via `echarts-for-react`)
- **Auth:** manual OTP allowlist — no OAuth, no database
