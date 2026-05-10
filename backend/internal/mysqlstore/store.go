package mysqlstore

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"

	"probx/backend/internal/models"
)

var (
	ErrNotFound = errors.New("not found")
	ErrInvalid  = errors.New("invalid request")
)

type Store struct {
	db *sql.DB
}

func Open(dsn string) (*Store, error) {
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(16)
	db.SetMaxIdleConns(8)
	db.SetConnMaxLifetime(30 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := ensureSchema(ctx, db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) Ping(ctx context.Context) error {
	return s.db.PingContext(ctx)
}

func (s *Store) Bootstrap(ctx context.Context, owner string) (models.Bootstrap, error) {
	markets, err := s.ListMarkets(ctx)
	if err != nil {
		return models.Bootstrap{}, err
	}
	positions, err := s.ListPositions(ctx, owner)
	if err != nil {
		return models.Bootstrap{}, err
	}
	activity, err := s.ListActivity(ctx, "", 40)
	if err != nil {
		return models.Bootstrap{}, err
	}
	return models.Bootstrap{Markets: markets, Positions: positions, Activity: activity}, nil
}

func (s *Store) ListMarkets(ctx context.Context) ([]models.Market, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, public_key, creator, question, category, avatar_url, yes_pool, no_pool,
		       total_liquidity, volume_24h, participants, change_24h, end_time,
		       resolved, outcome
		FROM markets
		ORDER BY resolved ASC, end_time ASC, created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	markets := []models.Market{}
	for rows.Next() {
		market, err := scanMarket(rows)
		if err != nil {
			return nil, err
		}
		markets = append(markets, market)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return s.withProbabilityHistory(ctx, markets)
}

func (s *Store) GetMarket(ctx context.Context, id string) (models.Market, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, public_key, creator, question, category, avatar_url, yes_pool, no_pool,
		       total_liquidity, volume_24h, participants, change_24h, end_time,
		       resolved, outcome
		FROM markets
		WHERE id = ?`, id)
	market, err := scanMarket(row)
	if errors.Is(err, sql.ErrNoRows) {
		return models.Market{}, ErrNotFound
	}
	if err != nil {
		return models.Market{}, err
	}
	markets, err := s.withProbabilityHistory(ctx, []models.Market{market})
	if err != nil {
		return models.Market{}, err
	}
	return markets[0], nil
}

func (s *Store) CreateMarket(ctx context.Context, req models.CreateMarketRequest) (models.Market, error) {
	req.Question = strings.TrimSpace(req.Question)
	req.Category = normalizeCategory(req.Category)
	req.AvatarURL = strings.TrimSpace(req.AvatarURL)
	req.Creator = normalizeText(req.Creator, "local")
	if req.Question == "" {
		return models.Market{}, fmt.Errorf("%w: question is required", ErrInvalid)
	}
	if len(req.AvatarURL) > 360_000 {
		return models.Market{}, fmt.Errorf("%w: avatarUrl is too large", ErrInvalid)
	}
	if req.EndTime <= time.Now().Unix() {
		return models.Market{}, fmt.Errorf("%w: endTime must be in the future", ErrInvalid)
	}
	if req.InitialLiquidity <= 0 {
		req.InitialLiquidity = 1
	}
	if req.ID == "" {
		req.ID = newID("market")
	}
	if req.PublicKey == "" {
		req.PublicKey = req.ID
	}

	now := nowMillis()
	yesPool := req.InitialLiquidity
	noPool := req.InitialLiquidity

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return models.Market{}, err
	}
	defer rollbackQuietly(tx)

	_, err = tx.ExecContext(ctx, `
		INSERT INTO markets (
			id, public_key, creator, question, category, avatar_url, yes_pool, no_pool,
			total_liquidity, volume_24h, participants, change_24h, end_time,
			resolved, outcome, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 0, ?, FALSE, NULL, ?, ?)`,
		req.ID, req.PublicKey, req.Creator, req.Question, req.Category, nullableString(req.AvatarURL),
		yesPool, noPool, req.InitialLiquidity, req.EndTime, now, now,
	)
	if err != nil {
		return models.Market{}, err
	}
	if err := insertProbabilityPoint(ctx, tx, req.ID, probability(yesPool, noPool), now); err != nil {
		return models.Market{}, err
	}
	if err := tx.Commit(); err != nil {
		return models.Market{}, err
	}
	return s.GetMarket(ctx, req.ID)
}

func (s *Store) UpdateMarketMetadata(ctx context.Context, marketID string, req models.UpdateMarketMetadataRequest) (models.Market, error) {
	marketID = strings.TrimSpace(marketID)
	req.Category = normalizeCategory(req.Category)
	req.AvatarURL = strings.TrimSpace(req.AvatarURL)
	if marketID == "" {
		return models.Market{}, fmt.Errorf("%w: market id is required", ErrInvalid)
	}
	if len(req.AvatarURL) > 360_000 {
		return models.Market{}, fmt.Errorf("%w: avatarUrl is too large", ErrInvalid)
	}

	result, err := s.db.ExecContext(ctx, `
		UPDATE markets
		SET category = ?, avatar_url = ?, updated_at = ?
		WHERE id = ?`,
		req.Category,
		nullableString(req.AvatarURL),
		nowMillis(),
		marketID,
	)
	if err != nil {
		return models.Market{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return models.Market{}, err
	}
	if affected == 0 {
		return models.Market{}, ErrNotFound
	}
	return s.GetMarket(ctx, marketID)
}

func (s *Store) UpsertIndexedMarket(ctx context.Context, market models.Market) (models.Market, error) {
	rawCategory := strings.TrimSpace(market.Category)
	market.ID = normalizeText(market.ID, market.PublicKey)
	market.PublicKey = strings.TrimSpace(market.PublicKey)
	market.Creator = normalizeText(market.Creator, "unknown")
	market.Question = strings.TrimSpace(market.Question)
	market.AvatarURL = strings.TrimSpace(market.AvatarURL)
	if rawCategory != "" {
		market.Category = normalizeCategory(rawCategory)
	}
	if market.ID == "" || market.PublicKey == "" {
		return models.Market{}, fmt.Errorf("%w: market id and publicKey are required", ErrInvalid)
	}
	if market.Question == "" {
		return models.Market{}, fmt.Errorf("%w: question is required", ErrInvalid)
	}
	if len(market.AvatarURL) > 360_000 {
		return models.Market{}, fmt.Errorf("%w: avatarUrl is too large", ErrInvalid)
	}

	now := nowMillis()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return models.Market{}, err
	}
	defer rollbackQuietly(tx)

	var existing struct {
		ID           string
		YesPool      float64
		NoPool       float64
		Volume24h    float64
		Participants int
		Category     string
	}
	row := tx.QueryRowContext(ctx, `
		SELECT id, yes_pool, no_pool, volume_24h, participants, category
		FROM markets
		WHERE public_key = ?
		FOR UPDATE`, market.PublicKey)
	err = row.Scan(
		&existing.ID,
		&existing.YesPool,
		&existing.NoPool,
		&existing.Volume24h,
		&existing.Participants,
		&existing.Category,
	)
	if errors.Is(err, sql.ErrNoRows) {
		if rawCategory == "" {
			market.Category = "Crypto"
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO markets (
				id, public_key, creator, question, category, avatar_url, yes_pool, no_pool,
				total_liquidity, volume_24h, participants, change_24h, end_time,
				resolved, outcome, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 0, ?, ?, ?, ?, ?)`,
			market.ID, market.PublicKey, market.Creator, market.Question, market.Category, nullableString(market.AvatarURL),
			market.YesPool, market.NoPool, market.TotalLiquidity, market.EndTime,
			market.Resolved, nullableInt(market.Outcome), now, now,
		)
		if err != nil {
			return models.Market{}, err
		}
		if err := insertProbabilityPoint(ctx, tx, market.ID, probability(market.YesPool, market.NoPool), now); err != nil {
			return models.Market{}, err
		}
		if err := tx.Commit(); err != nil {
			return models.Market{}, err
		}
		return s.GetMarket(ctx, market.ID)
	}
	if err != nil {
		return models.Market{}, err
	}

	market.ID = existing.ID
	if rawCategory == "" {
		market.Category = existing.Category
	}
	change24h := probability(market.YesPool, market.NoPool) - probability(existing.YesPool, existing.NoPool)
	_, err = tx.ExecContext(ctx, `
		UPDATE markets
		SET creator = ?, question = ?, category = ?, avatar_url = COALESCE(?, avatar_url), yes_pool = ?, no_pool = ?,
		    total_liquidity = ?, change_24h = ?, end_time = ?, resolved = ?,
		    outcome = ?, updated_at = ?
		WHERE id = ?`,
		market.Creator, market.Question, market.Category, nullableString(market.AvatarURL), market.YesPool, market.NoPool,
		market.TotalLiquidity, change24h, market.EndTime, market.Resolved,
		nullableInt(market.Outcome), now, market.ID,
	)
	if err != nil {
		return models.Market{}, err
	}
	if err := insertProbabilityPoint(ctx, tx, market.ID, probability(market.YesPool, market.NoPool), now); err != nil {
		return models.Market{}, err
	}
	if err := tx.Commit(); err != nil {
		return models.Market{}, err
	}
	return s.GetMarket(ctx, market.ID)
}

func (s *Store) UpsertIndexedPosition(ctx context.Context, position models.IndexedPosition) error {
	position.PublicKey = strings.TrimSpace(position.PublicKey)
	position.Owner = strings.TrimSpace(position.Owner)
	position.MarketPublicKey = strings.TrimSpace(position.MarketPublicKey)
	if position.PublicKey == "" || position.Owner == "" || position.MarketPublicKey == "" {
		return fmt.Errorf("%w: position publicKey, owner, and marketPublicKey are required", ErrInvalid)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer rollbackQuietly(tx)

	var market struct {
		ID       string
		YesPool  float64
		NoPool   float64
		Resolved bool
	}
	row := tx.QueryRowContext(ctx, `
		SELECT id, yes_pool, no_pool, resolved
		FROM markets
		WHERE public_key = ?
		FOR UPDATE`, position.MarketPublicKey)
	err = row.Scan(&market.ID, &market.YesPool, &market.NoPool, &market.Resolved)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	now := nowMillis()
	if err := upsertIndexedPositionSide(ctx, tx, position.Owner, market.ID, "YES", position.YesAmount, probability(market.YesPool, market.NoPool), market.Resolved, now); err != nil {
		return err
	}
	if err := upsertIndexedPositionSide(ctx, tx, position.Owner, market.ID, "NO", position.NoAmount, 1-probability(market.YesPool, market.NoPool), market.Resolved, now); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		UPDATE markets
		SET participants = (
			SELECT COUNT(DISTINCT owner)
			FROM positions
			WHERE market_id = ? AND size > 0
		), updated_at = ?
		WHERE id = ?`, market.ID, now, market.ID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) GetIndexerCursor(ctx context.Context, name string) (models.IndexerCursor, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return models.IndexerCursor{}, fmt.Errorf("%w: indexer cursor name is required", ErrInvalid)
	}
	var cursor models.IndexerCursor
	row := s.db.QueryRowContext(ctx, `
		SELECT cursor_signature, cursor_slot, updated_at
		FROM indexer_state
		WHERE name = ?`, name)
	err := row.Scan(&cursor.Signature, &cursor.Slot, &cursor.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return models.IndexerCursor{}, nil
	}
	return cursor, err
}

func (s *Store) SaveIndexerCursor(ctx context.Context, name string, cursor models.IndexerCursor) error {
	name = strings.TrimSpace(name)
	cursor.Signature = strings.TrimSpace(cursor.Signature)
	if name == "" {
		return fmt.Errorf("%w: indexer cursor name is required", ErrInvalid)
	}
	if cursor.Signature == "" {
		return fmt.Errorf("%w: indexer cursor signature is required", ErrInvalid)
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO indexer_state (name, cursor_signature, cursor_slot, updated_at)
		VALUES (?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
		  cursor_signature = VALUES(cursor_signature),
		  cursor_slot = VALUES(cursor_slot),
		  updated_at = VALUES(updated_at)`,
		name, cursor.Signature, cursor.Slot, nowMillis(),
	)
	return err
}

func (s *Store) IndexProgramEvent(ctx context.Context, event models.IndexedEvent) (bool, error) {
	event.ID = strings.TrimSpace(event.ID)
	event.Signature = strings.TrimSpace(event.Signature)
	event.Type = strings.TrimSpace(event.Type)
	event.MarketPublicKey = strings.TrimSpace(event.MarketPublicKey)
	event.Owner = strings.TrimSpace(event.Owner)
	event.Side = strings.ToUpper(strings.TrimSpace(event.Side))
	event.Action = strings.ToUpper(strings.TrimSpace(event.Action))
	if event.ID == "" || event.Signature == "" || event.Type == "" || event.MarketPublicKey == "" {
		return false, fmt.Errorf("%w: event id, signature, type, and marketPublicKey are required", ErrInvalid)
	}
	if event.TimestampMillis <= 0 {
		event.TimestampMillis = nowMillis()
	}
	if event.Action == "" {
		event.Action = "BUY"
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer rollbackQuietly(tx)

	inserted, err := insertIndexedEvent(ctx, tx, event)
	if err != nil || !inserted {
		return inserted, err
	}

	if event.Type == "MarketCreated" {
		if err := indexCreatedEvent(ctx, tx, event); err != nil {
			return false, err
		}
		if err := tx.Commit(); err != nil {
			return false, err
		}
		return true, nil
	}

	market, err := selectMarketByPublicKeyForUpdate(ctx, tx, event.MarketPublicKey)
	if err != nil {
		return false, err
	}

	switch event.Type {
	case "SharesBought", "SharesSold", "BetPlaced":
		if err := indexTradeEvent(ctx, tx, market, event); err != nil {
			return false, err
		}
	case "MarketResolved":
		if err := indexResolvedEvent(ctx, tx, market, event); err != nil {
			return false, err
		}
	case "WinningsRedeemed":
		if err := indexRedeemedEvent(ctx, tx, market, event); err != nil {
			return false, err
		}
	}

	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Store) ListPositions(ctx context.Context, owner string) ([]models.Position, error) {
	owner = strings.TrimSpace(owner)
	if owner == "" {
		return []models.Position{}, nil
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT p.id, p.market_id, p.side, p.size, p.entry_probability,
		       CASE WHEN p.side = 'YES'
		         THEN IF((m.yes_pool + m.no_pool) <= 0, 0, m.yes_pool / (m.yes_pool + m.no_pool))
		         ELSE IF((m.yes_pool + m.no_pool) <= 0, 0, m.no_pool / (m.yes_pool + m.no_pool))
		       END AS current_probability,
		       p.resolved
		FROM positions p
		JOIN markets m ON m.id = p.market_id
		WHERE p.owner = ?
		ORDER BY p.updated_at DESC`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	positions := []models.Position{}
	for rows.Next() {
		position, err := scanPosition(rows)
		if err != nil {
			return nil, err
		}
		positions = append(positions, position)
	}
	return positions, rows.Err()
}

func (s *Store) ListActivity(ctx context.Context, marketID string, limit int) ([]models.AgentActivity, error) {
	if limit <= 0 || limit > 100 {
		limit = 40
	}

	var (
		rows *sql.Rows
		err  error
	)
	if strings.TrimSpace(marketID) == "" {
		rows, err = s.db.QueryContext(ctx, `
			SELECT id, agent, market_id, side, action, size, confidence, timestamp_ms
			FROM agent_activity
			ORDER BY timestamp_ms DESC
			LIMIT ?`, limit)
	} else {
		rows, err = s.db.QueryContext(ctx, `
			SELECT id, agent, market_id, side, action, size, confidence, timestamp_ms
			FROM agent_activity
			WHERE market_id = ?
			ORDER BY timestamp_ms DESC
			LIMIT ?`, marketID, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []models.AgentActivity{}
	for rows.Next() {
		item, err := scanActivity(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) ListTrades(ctx context.Context, filter models.TradeFilter) (models.TradePage, error) {
	filter.Owner = strings.TrimSpace(filter.Owner)
	filter.MarketID = strings.TrimSpace(filter.MarketID)
	filter.Signature = strings.TrimSpace(filter.Signature)
	filter.Side = strings.ToUpper(strings.TrimSpace(filter.Side))
	filter.Action = strings.ToUpper(strings.TrimSpace(filter.Action))
	filter.Status = strings.TrimSpace(strings.ToLower(filter.Status))
	filter.Cursor = strings.TrimSpace(filter.Cursor)
	if isSyntheticSignature(filter.Signature) {
		filter.Signature = ""
	}
	if filter.Limit <= 0 || filter.Limit > 100 {
		filter.Limit = 50
	}
	if filter.Side != "" && filter.Side != "YES" && filter.Side != "NO" {
		return models.TradePage{}, fmt.Errorf("%w: side must be YES or NO", ErrInvalid)
	}
	if filter.Action != "" && filter.Action != "BUY" && filter.Action != "SELL" {
		return models.TradePage{}, fmt.Errorf("%w: action must be BUY or SELL", ErrInvalid)
	}

	conditions := []string{"1=1"}
	args := []any{}
	if filter.Owner != "" {
		conditions = append(conditions, "owner = ?")
		args = append(args, filter.Owner)
	}
	if filter.MarketID != "" {
		conditions = append(conditions, "market_id = ?")
		args = append(args, filter.MarketID)
	}
	if filter.Signature != "" {
		conditions = append(conditions, "signature = ?")
		args = append(args, filter.Signature)
	}
	if filter.Side != "" {
		conditions = append(conditions, "side = ?")
		args = append(args, filter.Side)
	}
	if filter.Action != "" {
		conditions = append(conditions, "action = ?")
		args = append(args, filter.Action)
	}
	if filter.Status != "" {
		conditions = append(conditions, "status = ?")
		args = append(args, filter.Status)
	}
	if filter.Signature == "" && filter.Owner == "" && filter.MarketID == "" {
		return models.TradePage{}, fmt.Errorf("%w: owner, marketId, or signature is required", ErrInvalid)
	}
	if filter.Cursor != "" {
		cursorTime, cursorID, err := decodeTradeCursor(filter.Cursor)
		if err != nil {
			return models.TradePage{}, err
		}
		conditions = append(conditions, "(created_at < ? OR (created_at = ? AND id < ?))")
		args = append(args, cursorTime, cursorTime, cursorID)
	}

	query := `
		SELECT id, owner, market_id, side, action, amount_sol, price, signature, status, created_at
		FROM trades
		WHERE ` + strings.Join(conditions, " AND ") + `
		ORDER BY created_at DESC, id DESC
		LIMIT ?`
	args = append(args, filter.Limit+1)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return models.TradePage{}, err
	}
	defer rows.Close()

	trades := []models.Trade{}
	for rows.Next() {
		trade, err := scanTrade(rows)
		if err != nil {
			return models.TradePage{}, err
		}
		trades = append(trades, trade)
	}
	if err := rows.Err(); err != nil {
		return models.TradePage{}, err
	}

	page := models.TradePage{Trades: trades}
	if len(trades) > filter.Limit {
		last := trades[filter.Limit-1]
		page.Trades = trades[:filter.Limit]
		page.NextCursor = encodeTradeCursor(last)
	}
	return page, nil
}

func (s *Store) RecordTrade(ctx context.Context, req models.TradeRequest) (models.TradeResponse, error) {
	req.MarketID = strings.TrimSpace(req.MarketID)
	req.Owner = normalizeText(req.Owner, "local")
	req.Side = strings.ToUpper(strings.TrimSpace(req.Side))
	req.Action = strings.ToUpper(strings.TrimSpace(req.Action))
	if req.Action == "" {
		req.Action = "BUY"
	}
	req.Status = normalizeText(req.Status, "indexed")
	req.Signature = normalizeText(req.Signature, "simulated")
	if req.MarketID == "" {
		return models.TradeResponse{}, fmt.Errorf("%w: marketId is required", ErrInvalid)
	}
	if req.Side != "YES" && req.Side != "NO" {
		return models.TradeResponse{}, fmt.Errorf("%w: side must be YES or NO", ErrInvalid)
	}
	if req.Action != "BUY" && req.Action != "SELL" {
		return models.TradeResponse{}, fmt.Errorf("%w: action must be BUY or SELL", ErrInvalid)
	}
	if req.AmountSOL <= 0 || math.IsNaN(req.AmountSOL) || math.IsInf(req.AmountSOL, 0) {
		return models.TradeResponse{}, fmt.Errorf("%w: amountSol must be positive", ErrInvalid)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return models.TradeResponse{}, err
	}
	defer rollbackQuietly(tx)

	row := tx.QueryRowContext(ctx, `
		SELECT id, public_key, creator, question, category, avatar_url, yes_pool, no_pool,
		       total_liquidity, volume_24h, participants, change_24h, end_time,
		       resolved, outcome
		FROM markets
		WHERE id = ?
		FOR UPDATE`, req.MarketID)
	market, err := scanMarket(row)
	if errors.Is(err, sql.ErrNoRows) {
		return models.TradeResponse{}, ErrNotFound
	}
	if err != nil {
		return models.TradeResponse{}, err
	}
	if market.Resolved {
		return models.TradeResponse{}, fmt.Errorf("%w: market is resolved", ErrInvalid)
	}
	if market.EndTime <= time.Now().Unix() {
		return models.TradeResponse{}, fmt.Errorf("%w: market is closed", ErrInvalid)
	}

	previousProbability := probability(market.YesPool, market.NoPool)
	entryProbability := previousProbability
	if req.Side == "NO" {
		entryProbability = 1 - entryProbability
	}

	var (
		nextYesPool       float64
		nextNoPool        float64
		volumeDelta       float64
		participantsDelta int
	)
	now := nowMillis()

	if req.Action == "BUY" {
		var sharesOut float64
		sharesOut, nextYesPool, nextNoPool, err = quoteBuy(market.YesPool, market.NoPool, req.AmountSOL, req.Side)
		if err != nil {
			return models.TradeResponse{}, err
		}
		participantsDelta, err = upsertPosition(ctx, tx, req, sharesOut, entryProbability, now)
		if err != nil {
			return models.TradeResponse{}, err
		}
		market.TotalLiquidity += req.AmountSOL
		volumeDelta = req.AmountSOL
	} else {
		var lamportsOut float64
		lamportsOut, nextYesPool, nextNoPool, err = quoteSell(market.YesPool, market.NoPool, req.AmountSOL, req.Side)
		if err != nil {
			return models.TradeResponse{}, err
		}
		if market.TotalLiquidity < lamportsOut {
			return models.TradeResponse{}, fmt.Errorf("%w: insufficient market liquidity", ErrInvalid)
		}
		if err := reducePosition(ctx, tx, req, req.AmountSOL, now); err != nil {
			return models.TradeResponse{}, err
		}
		market.TotalLiquidity -= lamportsOut
		volumeDelta = lamportsOut
	}

	market.YesPool = nextYesPool
	market.NoPool = nextNoPool
	market.Volume24h += volumeDelta * 1000
	nextProbability := probability(market.YesPool, market.NoPool)
	market.Change24h = nextProbability - previousProbability

	market.Participants += participantsDelta

	_, err = tx.ExecContext(ctx, `
		UPDATE markets
		SET yes_pool = ?, no_pool = ?, total_liquidity = ?, volume_24h = ?,
		    participants = ?, change_24h = ?, updated_at = ?
		WHERE id = ?`,
		market.YesPool, market.NoPool, market.TotalLiquidity, market.Volume24h,
		market.Participants, market.Change24h, now, market.ID,
	)
	if err != nil {
		return models.TradeResponse{}, err
	}

	tradeID := newID("trade")
	_, err = tx.ExecContext(ctx, `
		INSERT INTO trades (id, owner, market_id, side, action, amount_sol, price, signature, status, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		tradeID, req.Owner, req.MarketID, req.Side, req.Action, req.AmountSOL, entryProbability, req.Signature, req.Status, now,
	)
	if err != nil {
		return models.TradeResponse{}, err
	}

	activity := models.AgentActivity{
		ID:         newID("act"),
		Agent:      shortAgentName(req.Owner),
		MarketID:   req.MarketID,
		Side:       req.Side,
		Action:     req.Action,
		Size:       volumeDelta * 1000,
		Confidence: 99,
		Timestamp:  now,
	}
	if err := insertActivity(ctx, tx, activity); err != nil {
		return models.TradeResponse{}, err
	}
	if err := insertProbabilityPoint(ctx, tx, req.MarketID, nextProbability, now); err != nil {
		return models.TradeResponse{}, err
	}
	if err := tx.Commit(); err != nil {
		return models.TradeResponse{}, err
	}

	market, err = s.GetMarket(ctx, req.MarketID)
	if err != nil {
		return models.TradeResponse{}, err
	}
	position, err := s.getPosition(ctx, req.Owner, req.MarketID, req.Side)
	if err != nil {
		return models.TradeResponse{}, err
	}
	return models.TradeResponse{
		Signature: req.Signature,
		Status:    req.Status,
		Market:    market,
		Position:  position,
		Activity:  activity,
	}, nil
}

func (s *Store) ResolveMarket(ctx context.Context, marketID string, req models.ResolveMarketRequest) (models.Market, error) {
	marketID = strings.TrimSpace(marketID)
	req.Resolver = normalizeText(req.Resolver, "local")
	req.Status = normalizeText(req.Status, "indexed")
	req.Signature = normalizeText(req.Signature, "indexed")
	if marketID == "" {
		return models.Market{}, fmt.Errorf("%w: market id is required", ErrInvalid)
	}
	if req.Outcome != 0 && req.Outcome != 1 {
		return models.Market{}, fmt.Errorf("%w: outcome must be 0 or 1", ErrInvalid)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return models.Market{}, err
	}
	defer rollbackQuietly(tx)

	row := tx.QueryRowContext(ctx, `
		SELECT id, public_key, creator, question, category, avatar_url, yes_pool, no_pool,
		       total_liquidity, volume_24h, participants, change_24h, end_time,
		       resolved, outcome
		FROM markets
		WHERE id = ?
		FOR UPDATE`, marketID)
	market, err := scanMarket(row)
	if errors.Is(err, sql.ErrNoRows) {
		return models.Market{}, ErrNotFound
	}
	if err != nil {
		return models.Market{}, err
	}
	if market.Resolved {
		return models.Market{}, fmt.Errorf("%w: market is already resolved", ErrInvalid)
	}
	if market.EndTime > time.Now().Unix() {
		return models.Market{}, fmt.Errorf("%w: market has not ended", ErrInvalid)
	}

	now := nowMillis()
	_, err = tx.ExecContext(ctx, `
		UPDATE markets
		SET resolved = TRUE, outcome = ?, updated_at = ?
		WHERE id = ?`, req.Outcome, now, market.ID)
	if err != nil {
		return models.Market{}, err
	}
	_, err = tx.ExecContext(ctx, `
		UPDATE positions
		SET resolved = TRUE, updated_at = ?
		WHERE market_id = ?`, now, market.ID)
	if err != nil {
		return models.Market{}, err
	}

	activity := models.AgentActivity{
		ID:         newID("act"),
		Agent:      shortAgentName(req.Resolver),
		MarketID:   market.ID,
		Side:       sideLabel(req.Outcome),
		Action:     "RESOLVE",
		Size:       0,
		Confidence: 100,
		Timestamp:  now,
	}
	if err := insertActivity(ctx, tx, activity); err != nil {
		return models.Market{}, err
	}
	if err := tx.Commit(); err != nil {
		return models.Market{}, err
	}
	return s.GetMarket(ctx, market.ID)
}

func (s *Store) RedeemPosition(ctx context.Context, positionID string, req models.RedeemPositionRequest) (models.RedeemPositionResponse, error) {
	positionID = strings.TrimSpace(positionID)
	req.Owner = normalizeText(req.Owner, "local")
	req.Status = normalizeText(req.Status, "indexed")
	req.Signature = normalizeText(req.Signature, "indexed")
	if positionID == "" {
		return models.RedeemPositionResponse{}, fmt.Errorf("%w: position id is required", ErrInvalid)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return models.RedeemPositionResponse{}, err
	}
	defer rollbackQuietly(tx)

	row := tx.QueryRowContext(ctx, `
		SELECT p.id, p.market_id, p.side, p.size, p.entry_probability,
		       CASE WHEN p.side = 'YES'
		         THEN IF((m.yes_pool + m.no_pool) <= 0, 0, m.yes_pool / (m.yes_pool + m.no_pool))
		         ELSE IF((m.yes_pool + m.no_pool) <= 0, 0, m.no_pool / (m.yes_pool + m.no_pool))
		       END AS current_probability,
		       p.resolved,
		       m.resolved, m.outcome
		FROM positions p
		JOIN markets m ON m.id = p.market_id
		WHERE p.id = ? AND p.owner = ?
		FOR UPDATE`, positionID, req.Owner)
	var (
		position       models.Position
		marketResolved bool
		outcome        sql.NullInt64
	)
	err = row.Scan(
		&position.ID,
		&position.MarketID,
		&position.Side,
		&position.Size,
		&position.EntryProbability,
		&position.CurrentProbability,
		&position.Resolved,
		&marketResolved,
		&outcome,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return models.RedeemPositionResponse{}, ErrNotFound
	}
	if err != nil {
		return models.RedeemPositionResponse{}, err
	}
	position.PnL = (position.CurrentProbability - position.EntryProbability) * position.Size * 100
	if !marketResolved || !outcome.Valid {
		return models.RedeemPositionResponse{}, fmt.Errorf("%w: market is not resolved", ErrInvalid)
	}
	if position.Size <= 0 {
		return models.RedeemPositionResponse{}, fmt.Errorf("%w: position has no claimable size", ErrInvalid)
	}
	if position.Side != sideLabel(int(outcome.Int64)) {
		return models.RedeemPositionResponse{}, fmt.Errorf("%w: position is not on the winning side", ErrInvalid)
	}

	now := nowMillis()
	_, err = tx.ExecContext(ctx, `
		UPDATE positions
		SET size = 0, pnl = 0, resolved = TRUE, updated_at = ?
		WHERE id = ?`, now, position.ID)
	if err != nil {
		return models.RedeemPositionResponse{}, err
	}
	_, err = tx.ExecContext(ctx, `
		UPDATE markets
		SET total_liquidity = GREATEST(total_liquidity - ?, 0), updated_at = ?
		WHERE id = ?`, position.Size, now, position.MarketID)
	if err != nil {
		return models.RedeemPositionResponse{}, err
	}
	if err := tx.Commit(); err != nil {
		return models.RedeemPositionResponse{}, err
	}

	market, err := s.GetMarket(ctx, position.MarketID)
	if err != nil {
		return models.RedeemPositionResponse{}, err
	}
	position.Size = 0
	position.PnL = 0
	position.Resolved = true
	return models.RedeemPositionResponse{
		Signature: req.Signature,
		Status:    req.Status,
		Market:    market,
		Position:  position,
	}, nil
}

func (s *Store) getPosition(ctx context.Context, owner string, marketID string, side string) (models.Position, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT p.id, p.market_id, p.side, p.size, p.entry_probability,
		       CASE WHEN p.side = 'YES'
		         THEN IF((m.yes_pool + m.no_pool) <= 0, 0, m.yes_pool / (m.yes_pool + m.no_pool))
		         ELSE IF((m.yes_pool + m.no_pool) <= 0, 0, m.no_pool / (m.yes_pool + m.no_pool))
		       END AS current_probability,
		       p.resolved
		FROM positions p
		JOIN markets m ON m.id = p.market_id
		WHERE p.owner = ? AND p.market_id = ? AND p.side = ?`, owner, marketID, side)
	position, err := scanPosition(row)
	if errors.Is(err, sql.ErrNoRows) {
		return models.Position{}, ErrNotFound
	}
	return position, err
}

func (s *Store) withProbabilityHistory(ctx context.Context, markets []models.Market) ([]models.Market, error) {
	for i := range markets {
		rows, err := s.db.QueryContext(ctx, `
			SELECT probability
			FROM probability_points
			WHERE market_id = ?
			ORDER BY recorded_at DESC
			LIMIT 96`, markets[i].ID)
		if err != nil {
			return nil, err
		}
		history := []float64{}
		for rows.Next() {
			var probability float64
			if err := rows.Scan(&probability); err != nil {
				_ = rows.Close()
				return nil, err
			}
			history = append(history, probability)
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
		reverse(history)
		if len(history) == 0 {
			current := probability(markets[i].YesPool, markets[i].NoPool)
			for j := 0; j < 72; j++ {
				history = append(history, current)
			}
		}
		markets[i].ProbabilityHistory = history
	}
	return markets, nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanMarket(row scanner) (models.Market, error) {
	var (
		market    models.Market
		avatarURL sql.NullString
		outcome   sql.NullInt64
	)
	err := row.Scan(
		&market.ID,
		&market.PublicKey,
		&market.Creator,
		&market.Question,
		&market.Category,
		&avatarURL,
		&market.YesPool,
		&market.NoPool,
		&market.TotalLiquidity,
		&market.Volume24h,
		&market.Participants,
		&market.Change24h,
		&market.EndTime,
		&market.Resolved,
		&outcome,
	)
	if err != nil {
		return models.Market{}, err
	}
	if avatarURL.Valid {
		market.AvatarURL = avatarURL.String
	}
	if outcome.Valid {
		value := int(outcome.Int64)
		market.Outcome = &value
	}
	return market, nil
}

func ensureSchema(ctx context.Context, db *sql.DB) error {
	if err := ensureColumn(ctx, db, "markets", "avatar_url", "MEDIUMTEXT NULL AFTER category"); err != nil {
		return err
	}
	if err := ensureColumn(ctx, db, "trades", "action", "VARCHAR(12) NOT NULL DEFAULT 'BUY' AFTER side"); err != nil {
		return err
	}
	if err := ensureIndex(ctx, db, "trades", "idx_trades_signature", "CREATE INDEX idx_trades_signature ON trades (signature)"); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS indexed_events (
		  id VARCHAR(120) NOT NULL PRIMARY KEY,
		  signature VARCHAR(128) NOT NULL,
		  slot BIGINT UNSIGNED NOT NULL DEFAULT 0,
		  event_type VARCHAR(32) NOT NULL,
		  created_at BIGINT NOT NULL,
		  UNIQUE KEY idx_indexed_events_signature_type (signature, event_type, id),
		  KEY idx_indexed_events_slot (slot),
		  KEY idx_indexed_events_created_at (created_at)
		)`); err != nil {
		return err
	}
	_, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS indexer_state (
		  name VARCHAR(64) NOT NULL PRIMARY KEY,
		  cursor_signature VARCHAR(128) NOT NULL,
		  cursor_slot BIGINT UNSIGNED NOT NULL DEFAULT 0,
		  updated_at BIGINT NOT NULL
		)`)
	return err
}

func ensureColumn(ctx context.Context, db *sql.DB, tableName string, columnName string, definition string) error {
	var count int
	err := db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM INFORMATION_SCHEMA.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
		tableName, columnName,
	).Scan(&count)
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	_, err = db.ExecContext(ctx, fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", tableName, columnName, definition))
	return err
}

func ensureIndex(ctx context.Context, db *sql.DB, tableName string, indexName string, statement string) error {
	var count int
	err := db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM INFORMATION_SCHEMA.STATISTICS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
		tableName,
		indexName,
	).Scan(&count)
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	_, err = db.ExecContext(ctx, statement)
	return err
}

func nullableInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullableString(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func scanPosition(row scanner) (models.Position, error) {
	var position models.Position
	err := row.Scan(
		&position.ID,
		&position.MarketID,
		&position.Side,
		&position.Size,
		&position.EntryProbability,
		&position.CurrentProbability,
		&position.Resolved,
	)
	if err != nil {
		return models.Position{}, err
	}
	position.PnL = (position.CurrentProbability - position.EntryProbability) * position.Size * 100
	return position, nil
}

func scanActivity(row scanner) (models.AgentActivity, error) {
	var item models.AgentActivity
	err := row.Scan(
		&item.ID,
		&item.Agent,
		&item.MarketID,
		&item.Side,
		&item.Action,
		&item.Size,
		&item.Confidence,
		&item.Timestamp,
	)
	return item, err
}

func scanTrade(row scanner) (models.Trade, error) {
	var trade models.Trade
	err := row.Scan(
		&trade.ID,
		&trade.Owner,
		&trade.MarketID,
		&trade.Side,
		&trade.Action,
		&trade.AmountSOL,
		&trade.Price,
		&trade.Signature,
		&trade.Status,
		&trade.CreatedAt,
	)
	if trade.Action == "" {
		trade.Action = "BUY"
	}
	return trade, err
}

func selectMarketByPublicKeyForUpdate(ctx context.Context, tx *sql.Tx, publicKey string) (models.Market, error) {
	row := tx.QueryRowContext(ctx, `
		SELECT id, public_key, creator, question, category, avatar_url, yes_pool, no_pool,
		       total_liquidity, volume_24h, participants, change_24h, end_time,
		       resolved, outcome
		FROM markets
		WHERE public_key = ?
		FOR UPDATE`, publicKey)
	market, err := scanMarket(row)
	if errors.Is(err, sql.ErrNoRows) {
		return models.Market{}, ErrNotFound
	}
	return market, err
}

func insertIndexedEvent(ctx context.Context, tx *sql.Tx, event models.IndexedEvent) (bool, error) {
	result, err := tx.ExecContext(ctx, `
		INSERT IGNORE INTO indexed_events (id, signature, slot, event_type, created_at)
		VALUES (?, ?, ?, ?, ?)`,
		event.ID, event.Signature, event.Slot, event.Type, event.TimestampMillis,
	)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

func indexCreatedEvent(ctx context.Context, tx *sql.Tx, event models.IndexedEvent) error {
	event.Question = strings.TrimSpace(event.Question)
	if event.Question == "" {
		return fmt.Errorf("%w: created event question is required", ErrInvalid)
	}
	if event.EndTime <= 0 {
		return fmt.Errorf("%w: created event endTime is required", ErrInvalid)
	}
	marketID := event.MarketPublicKey
	if event.OnchainID > 0 {
		marketID = fmt.Sprintf("market_%d", event.OnchainID)
	}
	creator := normalizeText(event.Owner, "unknown")
	_, err := tx.ExecContext(ctx, `
		INSERT INTO markets (
			id, public_key, creator, question, category, avatar_url, yes_pool, no_pool,
			total_liquidity, volume_24h, participants, change_24h, end_time,
			resolved, outcome, created_at, updated_at
		) VALUES (?, ?, ?, ?, 'Crypto', NULL, ?, ?, ?, 0, 1, 0, ?, FALSE, NULL, ?, ?)
		ON DUPLICATE KEY UPDATE
		  creator = VALUES(creator),
		  question = VALUES(question),
		  yes_pool = VALUES(yes_pool),
		  no_pool = VALUES(no_pool),
		  total_liquidity = VALUES(total_liquidity),
		  end_time = VALUES(end_time),
		  updated_at = GREATEST(updated_at, VALUES(updated_at))`,
		marketID,
		event.MarketPublicKey,
		creator,
		event.Question,
		event.YesPool,
		event.NoPool,
		event.TotalLiquidity,
		event.EndTime,
		event.TimestampMillis,
		event.TimestampMillis,
	)
	if err != nil {
		return err
	}
	if event.YesPool > 0 || event.NoPool > 0 {
		if err := insertProbabilityPoint(ctx, tx, marketID, probability(event.YesPool, event.NoPool), event.TimestampMillis); err != nil {
			return err
		}
	}
	return insertActivity(ctx, tx, models.AgentActivity{
		ID:         "act_" + event.ID,
		Agent:      shortAgentName(creator),
		MarketID:   marketID,
		Side:       "YES",
		Action:     "CREATE",
		Size:       event.TotalLiquidity * 1000,
		Confidence: 100,
		Timestamp:  event.TimestampMillis,
	})
}

func indexTradeEvent(ctx context.Context, tx *sql.Tx, market models.Market, event models.IndexedEvent) error {
	if event.Side != "YES" && event.Side != "NO" {
		return fmt.Errorf("%w: event side must be YES or NO", ErrInvalid)
	}
	if event.Action != "BUY" && event.Action != "SELL" {
		return fmt.Errorf("%w: event action must be BUY or SELL", ErrInvalid)
	}
	if event.Type == "BetPlaced" && hasIndexedSignatureType(ctx, tx, event.Signature, "SharesBought") {
		return nil
	}
	if hasRecordedTradeSignature(ctx, tx, event.Signature) {
		return confirmPendingTrade(ctx, tx, event)
	}
	size := event.AmountSOL
	if event.Action == "SELL" && event.Shares > 0 {
		size = event.Shares
	}
	price := probability(event.YesPool, event.NoPool)
	if event.Side == "NO" {
		price = 1 - price
	}
	_, err := tx.ExecContext(ctx, `
		INSERT IGNORE INTO trades (id, owner, market_id, side, action, amount_sol, price, signature, status, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
		indexedTradeID(event),
		normalizeText(event.Owner, "unknown"),
		market.ID,
		event.Side,
		event.Action,
		size,
		price,
		event.Signature,
		event.TimestampMillis,
	)
	if err != nil {
		return err
	}
	if event.YesPool > 0 || event.NoPool > 0 {
		if err := insertProbabilityPoint(ctx, tx, market.ID, probability(event.YesPool, event.NoPool), event.TimestampMillis); err != nil {
			return err
		}
	}
	return insertActivity(ctx, tx, models.AgentActivity{
		ID:         "act_" + event.ID,
		Agent:      shortAgentName(event.Owner),
		MarketID:   market.ID,
		Side:       event.Side,
		Action:     event.Action,
		Size:       size * 1000,
		Confidence: 100,
		Timestamp:  event.TimestampMillis,
	})
}

func hasIndexedSignatureType(ctx context.Context, tx *sql.Tx, signature string, eventType string) bool {
	var count int
	err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM indexed_events
		WHERE signature = ? AND event_type = ?`,
		signature,
		eventType,
	).Scan(&count)
	return err == nil && count > 0
}

func hasRecordedTradeSignature(ctx context.Context, tx *sql.Tx, signature string) bool {
	signature = strings.TrimSpace(signature)
	if isSyntheticSignature(signature) {
		return false
	}
	var count int
	err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM trades
		WHERE signature = ?`,
		signature,
	).Scan(&count)
	return err == nil && count > 0
}

func confirmPendingTrade(ctx context.Context, tx *sql.Tx, event models.IndexedEvent) error {
	_, err := tx.ExecContext(ctx, `
		UPDATE trades
		SET status = 'confirmed',
		    action = ?,
		    created_at = LEAST(created_at, ?)
		WHERE signature = ? AND status <> 'confirmed'`,
		event.Action,
		event.TimestampMillis,
		event.Signature,
	)
	return err
}

func isSyntheticSignature(signature string) bool {
	signature = strings.TrimSpace(signature)
	return signature == "" || signature == "indexed" || signature == "simulated" || signature == "local"
}

func indexedTradeID(event models.IndexedEvent) string {
	if strings.TrimSpace(event.Signature) != "" && event.InstructionIndex >= 0 {
		return fmt.Sprintf("trade_%s_%d", stableToken(event.Signature), event.InstructionIndex)
	}
	return "evt_" + event.ID
}

func indexResolvedEvent(ctx context.Context, tx *sql.Tx, market models.Market, event models.IndexedEvent) error {
	if event.Outcome == nil {
		return fmt.Errorf("%w: resolved event outcome is required", ErrInvalid)
	}
	_, err := tx.ExecContext(ctx, `
		UPDATE markets
		SET resolved = TRUE, outcome = ?, updated_at = GREATEST(updated_at, ?)
		WHERE id = ?`,
		*event.Outcome, event.TimestampMillis, market.ID,
	)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		UPDATE positions
		SET resolved = TRUE, updated_at = GREATEST(updated_at, ?)
		WHERE market_id = ?`, event.TimestampMillis, market.ID)
	if err != nil {
		return err
	}
	return insertActivity(ctx, tx, models.AgentActivity{
		ID:         "act_" + event.ID,
		Agent:      shortAgentName(event.Owner),
		MarketID:   market.ID,
		Side:       sideLabel(*event.Outcome),
		Action:     "RESOLVE",
		Size:       0,
		Confidence: 100,
		Timestamp:  event.TimestampMillis,
	})
}

func indexRedeemedEvent(ctx context.Context, tx *sql.Tx, market models.Market, event models.IndexedEvent) error {
	if event.Outcome == nil {
		return fmt.Errorf("%w: redeemed event outcome is required", ErrInvalid)
	}
	return insertActivity(ctx, tx, models.AgentActivity{
		ID:         "act_" + event.ID,
		Agent:      shortAgentName(event.Owner),
		MarketID:   market.ID,
		Side:       sideLabel(*event.Outcome),
		Action:     "REDEEM",
		Size:       event.PayoutSOL * 1000,
		Confidence: 100,
		Timestamp:  event.TimestampMillis,
	})
}

func upsertPosition(ctx context.Context, tx *sql.Tx, req models.TradeRequest, sharesOut float64, entryProbability float64, now int64) (int, error) {
	id := positionID(req.Owner, req.MarketID, req.Side)
	var existingSize float64
	row := tx.QueryRowContext(ctx, `
		SELECT size
		FROM positions
		WHERE owner = ? AND market_id = ? AND side = ?
		FOR UPDATE`, req.Owner, req.MarketID, req.Side)
	err := row.Scan(&existingSize)
	if errors.Is(err, sql.ErrNoRows) {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO positions (
				id, owner, market_id, side, size, entry_probability,
				current_probability, pnl, resolved, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, 0, FALSE, ?, ?)`,
			id, req.Owner, req.MarketID, req.Side, sharesOut, entryProbability, entryProbability, now, now,
		)
		return 1, err
	}
	if err != nil {
		return 0, err
	}

	_, err = tx.ExecContext(ctx, `
		UPDATE positions
		SET size = size + ?,
		    entry_probability = ((entry_probability * ?) + (? * ?)) / (? + ?),
		    updated_at = ?
		WHERE owner = ? AND market_id = ? AND side = ?`,
		sharesOut,
		existingSize,
		entryProbability,
		sharesOut,
		existingSize,
		sharesOut,
		now,
		req.Owner,
		req.MarketID,
		req.Side,
	)
	return 0, err
}

func upsertIndexedPositionSide(ctx context.Context, tx *sql.Tx, owner string, marketID string, side string, size float64, entryProbability float64, resolved bool, now int64) error {
	id := positionID(owner, marketID, side)
	var existingSize float64
	row := tx.QueryRowContext(ctx, `
		SELECT size
		FROM positions
		WHERE owner = ? AND market_id = ? AND side = ?
		FOR UPDATE`, owner, marketID, side)
	err := row.Scan(&existingSize)
	if errors.Is(err, sql.ErrNoRows) {
		if size <= 0 {
			return nil
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO positions (
				id, owner, market_id, side, size, entry_probability,
				current_probability, pnl, resolved, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
			id, owner, marketID, side, size, entryProbability, entryProbability, resolved, now, now,
		)
		return err
	}
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, `
		UPDATE positions
		SET size = ?, resolved = ?, updated_at = ?
		WHERE owner = ? AND market_id = ? AND side = ?`,
		size,
		resolved,
		now,
		owner,
		marketID,
		side,
	)
	_ = existingSize
	return err
}

func reducePosition(ctx context.Context, tx *sql.Tx, req models.TradeRequest, sharesSold float64, now int64) error {
	var existingSize float64
	row := tx.QueryRowContext(ctx, `
		SELECT size
		FROM positions
		WHERE owner = ? AND market_id = ? AND side = ?
		FOR UPDATE`, req.Owner, req.MarketID, req.Side)
	err := row.Scan(&existingSize)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: position not found", ErrInvalid)
	}
	if err != nil {
		return err
	}
	if existingSize+1e-9 < sharesSold {
		return fmt.Errorf("%w: insufficient position shares", ErrInvalid)
	}

	_, err = tx.ExecContext(ctx, `
		UPDATE positions
		SET size = GREATEST(size - ?, 0),
		    updated_at = ?
		WHERE owner = ? AND market_id = ? AND side = ?`,
		sharesSold,
		now,
		req.Owner,
		req.MarketID,
		req.Side,
	)
	return err
}

func insertActivity(ctx context.Context, tx *sql.Tx, item models.AgentActivity) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO agent_activity (id, agent, market_id, side, action, size, confidence, timestamp_ms)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		item.ID, item.Agent, item.MarketID, item.Side, item.Action, item.Size, item.Confidence, item.Timestamp,
	)
	return err
}

func insertProbabilityPoint(ctx context.Context, tx *sql.Tx, marketID string, value float64, recordedAt int64) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO probability_points (market_id, probability, recorded_at)
		VALUES (?, ?, ?)`, marketID, value, recordedAt)
	return err
}

func probability(yesPool float64, noPool float64) float64 {
	total := yesPool + noPool
	if total <= 0 {
		return 0
	}
	return yesPool / total
}

func quoteBuy(yesPool float64, noPool float64, amount float64, side string) (float64, float64, float64, error) {
	if yesPool <= 0 || noPool <= 0 {
		return 0, 0, 0, fmt.Errorf("%w: market has no AMM liquidity", ErrInvalid)
	}
	invariant := yesPool * noPool
	if side == "YES" {
		nextYesPool := yesPool + amount
		nextNoPool := invariant / nextYesPool
		sharesOut := noPool - nextNoPool
		if sharesOut <= 0 {
			return 0, 0, 0, fmt.Errorf("%w: amount is too small for AMM liquidity", ErrInvalid)
		}
		return sharesOut, nextYesPool, nextNoPool, nil
	}
	nextNoPool := noPool + amount
	nextYesPool := invariant / nextNoPool
	sharesOut := yesPool - nextYesPool
	if sharesOut <= 0 {
		return 0, 0, 0, fmt.Errorf("%w: amount is too small for AMM liquidity", ErrInvalid)
	}
	return sharesOut, nextYesPool, nextNoPool, nil
}

func quoteSell(yesPool float64, noPool float64, shares float64, side string) (float64, float64, float64, error) {
	if yesPool <= 0 || noPool <= 0 {
		return 0, 0, 0, fmt.Errorf("%w: market has no AMM liquidity", ErrInvalid)
	}
	invariant := yesPool * noPool
	if side == "YES" {
		nextNoPool := noPool + shares
		nextYesPool := invariant / nextNoPool
		lamportsOut := yesPool - nextYesPool
		if lamportsOut <= 0 {
			return 0, 0, 0, fmt.Errorf("%w: amount is too small for AMM liquidity", ErrInvalid)
		}
		return lamportsOut, nextYesPool, nextNoPool, nil
	}
	nextYesPool := yesPool + shares
	nextNoPool := invariant / nextYesPool
	lamportsOut := noPool - nextNoPool
	if lamportsOut <= 0 {
		return 0, 0, 0, fmt.Errorf("%w: amount is too small for AMM liquidity", ErrInvalid)
	}
	return lamportsOut, nextYesPool, nextNoPool, nil
}

func normalizeCategory(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "politics":
		return "Politics"
	case "sports":
		return "Sports"
	case "tech":
		return "Tech"
	case "macro":
		return "Macro"
	case "on-chain", "onchain":
		return "On-chain"
	default:
		return "Crypto"
	}
}

func normalizeText(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func positionID(owner string, marketID string, side string) string {
	return "pos_" + stableToken(owner) + "_" + stableToken(marketID) + "_" + strings.ToLower(side)
}

func shortAgentName(owner string) string {
	owner = strings.TrimSpace(owner)
	if owner == "" || owner == "local" {
		return "You"
	}
	if len(owner) <= 6 {
		return owner
	}
	return owner[:6]
}

func sideLabel(outcome int) string {
	if outcome == 1 {
		return "YES"
	}
	return "NO"
}

func stableToken(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	replacer := strings.NewReplacer("/", "_", "\\", "_", ":", "_", " ", "_")
	value = replacer.Replace(value)
	if len(value) > 32 {
		return value[:32]
	}
	return value
}

func encodeTradeCursor(trade models.Trade) string {
	return base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf("%d:%s", trade.CreatedAt, trade.ID)))
}

func decodeTradeCursor(cursor string) (int64, string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return 0, "", fmt.Errorf("%w: invalid trade cursor", ErrInvalid)
	}
	timestamp, id, ok := strings.Cut(string(raw), ":")
	if !ok || id == "" {
		return 0, "", fmt.Errorf("%w: invalid trade cursor", ErrInvalid)
	}
	createdAt, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || createdAt <= 0 {
		return 0, "", fmt.Errorf("%w: invalid trade cursor", ErrInvalid)
	}
	return createdAt, id, nil
}

func newID(prefix string) string {
	return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
}

func nowMillis() int64 {
	return time.Now().UnixMilli()
}

func reverse(values []float64) {
	for i, j := 0, len(values)-1; i < j; i, j = i+1, j-1 {
		values[i], values[j] = values[j], values[i]
	}
}

func rollbackQuietly(tx *sql.Tx) {
	_ = tx.Rollback()
}
