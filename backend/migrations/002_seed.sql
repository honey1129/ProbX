INSERT IGNORE INTO markets (
  id, public_key, creator, question, category, yes_pool, no_pool,
  total_liquidity, volume_24h, participants, change_24h, end_time,
  resolved, outcome, created_at, updated_at
) VALUES
  (
    'fed-rates',
    '6r4Ph92qKZ7sF2C9o5Z7k9S74L9u2f1XfeDf3Fed111',
    '7KxG4yqX8Ky8g5pNFr25xXrbR6dcXqFedCreator111',
    'Will the Fed cut rates at the next meeting?',
    'Politics',
    1320, 805, 2125, 8240000, 1428, 0.043,
    UNIX_TIMESTAMP(DATE_ADD(NOW(), INTERVAL 23 DAY)),
    FALSE, NULL,
    UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000,
    UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000
  ),
  (
    'btc-120k',
    '6r4Ph92qKZ7sF2C9o5Z7k9S74L9u2f1XfeDf3Btc111',
    '7KxG4yqX8Ky8g5pNFr25xXrbR6dcXqBtcCreator111',
    'Will Bitcoin trade above $120k before quarter end?',
    'Crypto',
    1670, 1360, 3030, 12470000, 2910, -0.021,
    UNIX_TIMESTAMP(DATE_ADD(NOW(), INTERVAL 45 DAY)),
    FALSE, NULL,
    UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000,
    UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000
  ),
  (
    'sol-etf',
    '6r4Ph92qKZ7sF2C9o5Z7k9S74L9u2f1XfeDf3Sol111',
    '7KxG4yqX8Ky8g5pNFr25xXrbR6dcXqSolCreator111',
    'Will a Solana ETF be approved before 2030?',
    'Crypto',
    322, 798, 1120, 4920000, 936, 0.068,
    UNIX_TIMESTAMP(DATE_ADD(NOW(), INTERVAL 80 DAY)),
    FALSE, NULL,
    UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000,
    UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000
  ),
  (
    'nba-finals',
    '6r4Ph92qKZ7sF2C9o5Z7k9S74L9u2f1XfeDf3Nba111',
    '7KxG4yqX8Ky8g5pNFr25xXrbR6dcXqNbaCreator111',
    'Will Boston win the next NBA title?',
    'Sports',
    280, 562, 842, 3210000, 785, -0.034,
    UNIX_TIMESTAMP(DATE_ADD(NOW(), INTERVAL 60 DAY)),
    FALSE, NULL,
    UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000,
    UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000
  ),
  (
    'sol-validators',
    '6r4Ph92qKZ7sF2C9o5Z7k9S74L9u2f1XfeDf3Val111',
    '7KxG4yqX8Ky8g5pNFr25xXrbR6dcXqValCreator111',
    'Will Solana daily active validators stay above 2,200 next week?',
    'On-chain',
    845, 524, 1369, 5780000, 1221, 0.029,
    UNIX_TIMESTAMP(DATE_ADD(NOW(), INTERVAL 12 DAY)),
    FALSE, NULL,
    UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000,
    UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000
  );

INSERT INTO probability_points (market_id, probability, recorded_at)
SELECT
  m.id,
  IF((m.yes_pool + m.no_pool) <= 0, 0, m.yes_pool / (m.yes_pool + m.no_pool)),
  UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000
FROM markets m
WHERE NOT EXISTS (
  SELECT 1
  FROM probability_points p
  WHERE p.market_id = m.id
);

INSERT IGNORE INTO agent_activity (
  id, agent, market_id, side, action, size, confidence, timestamp_ms
) VALUES
  ('seed-omega-fed', 'OmegaAgent', 'fed-rates', 'NO', 'SELL', 18000, 72, UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000),
  ('seed-alpha-btc', 'AlphaBot', 'btc-120k', 'YES', 'BUY', 26500, 76, UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000),
  ('seed-quant-sol', 'QuantMind', 'sol-etf', 'YES', 'BUY', 35000, 80, UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000),
  ('seed-stat-nba', 'StatArb', 'nba-finals', 'NO', 'SELL', 43500, 84, UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000),
  ('seed-macro-val', 'MacroSense', 'sol-validators', 'YES', 'BUY', 52000, 88, UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000);
