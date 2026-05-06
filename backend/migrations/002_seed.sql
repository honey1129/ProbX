INSERT IGNORE INTO markets (
  id, public_key, creator, question, category, yes_pool, no_pool,
  total_liquidity, volume_24h, participants, change_24h, end_time,
  resolved, outcome, created_at, updated_at
) VALUES
  (
    'fed-rates',
    '6r4Ph92qKZ7sF2C9o5Z7k9S74L9u2f1XfeDf3Fed111',
    '7KxG4yqX8Ky8g5pNFr25xXrbR6dcXqFedCreator111',
    'Will the Fed cut rates in June 2025?',
    'Macro',
    1320, 805, 2125, 8240000, 1428, 0.043,
    UNIX_TIMESTAMP(DATE_ADD(NOW(), INTERVAL 23 DAY)),
    FALSE, NULL,
    UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000,
    UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000
  ),
  (
    'btc-100k',
    '6r4Ph92qKZ7sF2C9o5Z7k9S74L9u2f1XfeDf3Btc111',
    '7KxG4yqX8Ky8g5pNFr25xXrbR6dcXqBtcCreator111',
    'Bitcoin above $100k by May 31?',
    'Crypto',
    1670, 1360, 3030, 12470000, 2910, -0.021,
    UNIX_TIMESTAMP(DATE_ADD(NOW(), INTERVAL 45 DAY)),
    FALSE, NULL,
    UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000,
    UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000
  ),
  (
    'trump-approval',
    '6r4Ph92qKZ7sF2C9o5Z7k9S74L9u2f1XfeDf3Pol111',
    '7KxG4yqX8Ky8g5pNFr25xXrbR6dcXqPolCreator111',
    'Trump approval rating above 50% by June?',
    'Politics',
    690, 960, 1650, 6310000, 1804, -0.017,
    UNIX_TIMESTAMP(DATE_ADD(NOW(), INTERVAL 18 DAY)),
    FALSE, NULL,
    UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000,
    UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000
  ),
  (
    'sol-etf',
    '6r4Ph92qKZ7sF2C9o5Z7k9S74L9u2f1XfeDf3Sol111',
    '7KxG4yqX8Ky8g5pNFr25xXrbR6dcXqSolCreator111',
    'Solana ETF approved in 2025?',
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
    'nvidia-earnings',
    '6r4Ph92qKZ7sF2C9o5Z7k9S74L9u2f1XfeDf3Nvda111',
    '7KxG4yqX8Ky8g5pNFr25xXrbR6dcXqNvdaCreator111',
    'NVIDIA earnings beat in May?',
    'Tech',
    982, 388, 1370, 5780000, 1221, 0.029,
    UNIX_TIMESTAMP(DATE_ADD(NOW(), INTERVAL 19 DAY)),
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
  ('seed-alpha-btc', 'AlphaBot', 'btc-100k', 'YES', 'BUY', 26500, 76, UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000),
  ('seed-quant-trump', 'QuantMind', 'trump-approval', 'NO', 'SELL', 35000, 80, UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000),
  ('seed-stat-sol', 'StatArb', 'sol-etf', 'YES', 'BUY', 43500, 84, UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000),
  ('seed-macro-nba', 'MacroSense', 'nba-finals', 'NO', 'SELL', 52000, 88, UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000),
  ('seed-event-nvda', 'EventHorizon', 'nvidia-earnings', 'YES', 'BUY', 60500, 76, UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000);
