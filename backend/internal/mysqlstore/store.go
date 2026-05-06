package mysqlstore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
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
		SELECT id, public_key, creator, question, category, yes_pool, no_pool,
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
		SELECT id, public_key, creator, question, category, yes_pool, no_pool,
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
	req.Creator = normalizeText(req.Creator, "local")
	if req.Question == "" {
		return models.Market{}, fmt.Errorf("%w: question is required", ErrInvalid)
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
			id, public_key, creator, question, category, yes_pool, no_pool,
			total_liquidity, volume_24h, participants, change_24h, end_time,
			resolved, outcome, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 0, ?, FALSE, NULL, ?, ?)`,
		req.ID, req.PublicKey, req.Creator, req.Question, req.Category,
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

func (s *Store) RecordTrade(ctx context.Context, req models.TradeRequest) (models.TradeResponse, error) {
	req.MarketID = strings.TrimSpace(req.MarketID)
	req.Owner = normalizeText(req.Owner, "local")
	req.Side = strings.ToUpper(strings.TrimSpace(req.Side))
	req.Status = normalizeText(req.Status, "indexed")
	req.Signature = normalizeText(req.Signature, "simulated")
	if req.MarketID == "" {
		return models.TradeResponse{}, fmt.Errorf("%w: marketId is required", ErrInvalid)
	}
	if req.Side != "YES" && req.Side != "NO" {
		return models.TradeResponse{}, fmt.Errorf("%w: side must be YES or NO", ErrInvalid)
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
		SELECT id, public_key, creator, question, category, yes_pool, no_pool,
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

	previousProbability := probability(market.YesPool, market.NoPool)
	entryProbability := previousProbability
	if req.Side == "NO" {
		entryProbability = 1 - entryProbability
	}

	sharesOut, nextYesPool, nextNoPool, err := quoteBuy(market.YesPool, market.NoPool, req.AmountSOL, req.Side)
	if err != nil {
		return models.TradeResponse{}, err
	}
	market.YesPool = nextYesPool
	market.NoPool = nextNoPool
	market.TotalLiquidity += req.AmountSOL
	market.Volume24h += req.AmountSOL * 1000
	nextProbability := probability(market.YesPool, market.NoPool)
	market.Change24h = nextProbability - previousProbability

	now := nowMillis()
	participantsDelta, err := upsertPosition(ctx, tx, req, sharesOut, entryProbability, now)
	if err != nil {
		return models.TradeResponse{}, err
	}
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
		INSERT INTO trades (id, owner, market_id, side, amount_sol, price, signature, status, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		tradeID, req.Owner, req.MarketID, req.Side, req.AmountSOL, entryProbability, req.Signature, req.Status, now,
	)
	if err != nil {
		return models.TradeResponse{}, err
	}

	activity := models.AgentActivity{
		ID:         newID("act"),
		Agent:      shortAgentName(req.Owner),
		MarketID:   req.MarketID,
		Side:       req.Side,
		Action:     "BUY",
		Size:       req.AmountSOL * 1000,
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
		market  models.Market
		outcome sql.NullInt64
	)
	err := row.Scan(
		&market.ID,
		&market.PublicKey,
		&market.Creator,
		&market.Question,
		&market.Category,
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
	if outcome.Valid {
		value := int(outcome.Int64)
		market.Outcome = &value
	}
	return market, nil
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

func normalizeCategory(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "politics":
		return "Politics"
	case "sports":
		return "Sports"
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

func stableToken(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	replacer := strings.NewReplacer("/", "_", "\\", "_", ":", "_", " ", "_")
	value = replacer.Replace(value)
	if len(value) > 32 {
		return value[:32]
	}
	return value
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
