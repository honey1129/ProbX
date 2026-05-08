UPDATE markets SET avatar_url = 'https://upload.wikimedia.org/wikipedia/commons/1/1a/Seal_of_the_United_States_Federal_Reserve_System.svg' WHERE id = 'fed-rates' AND (avatar_url IS NULL OR avatar_url = '');
UPDATE markets SET avatar_url = 'https://upload.wikimedia.org/wikipedia/commons/4/46/Bitcoin.svg' WHERE id = 'btc-100k' AND (avatar_url IS NULL OR avatar_url = '');
UPDATE markets SET avatar_url = 'https://upload.wikimedia.org/wikipedia/commons/d/d6/Donald_Trump_official_portrait%2C_2025_%28cropped_headshot%29.jpg' WHERE id = 'trump-approval' AND (avatar_url IS NULL OR avatar_url = '');
UPDATE markets SET avatar_url = 'https://upload.wikimedia.org/wikipedia/commons/e/ef/Solana-sol-logo-horizontal-2025.svg' WHERE id = 'sol-etf' AND (avatar_url IS NULL OR avatar_url = '');
UPDATE markets SET avatar_url = 'https://upload.wikimedia.org/wikipedia/commons/2/25/CelticsWordmark.svg' WHERE id = 'nba-finals' AND (avatar_url IS NULL OR avatar_url = '');
UPDATE markets SET avatar_url = 'https://upload.wikimedia.org/wikipedia/commons/4/48/Nvidia_Logo.svg' WHERE id = 'nvidia-earnings' AND (avatar_url IS NULL OR avatar_url = '');
