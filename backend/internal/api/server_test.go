package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"probx/backend/internal/chain"
	"probx/backend/internal/models"
	"probx/backend/internal/mysqlstore"
)

type fakeStore struct {
	market       models.Market
	recordCalled bool
}

func (f *fakeStore) Ping(ctx context.Context) error {
	return nil
}

func (f *fakeStore) Bootstrap(ctx context.Context, owner string) (models.Bootstrap, error) {
	return models.Bootstrap{
		Markets: []models.Market{f.market},
		Positions: []models.Position{
			{ID: "pos_1", MarketID: f.market.ID, Side: "YES", Size: 1, EntryProbability: 0.5, CurrentProbability: 0.6, PnL: 10},
		},
		Activity: []models.AgentActivity{
			{ID: "act_1", Agent: "You", MarketID: f.market.ID, Side: "YES", Action: "BUY", Size: 1000, Confidence: 99, Timestamp: 1},
		},
	}, nil
}

func (f *fakeStore) ListMarkets(ctx context.Context) ([]models.Market, error) {
	return []models.Market{f.market}, nil
}

func (f *fakeStore) GetMarket(ctx context.Context, id string) (models.Market, error) {
	if id != f.market.ID {
		return models.Market{}, mysqlstore.ErrNotFound
	}
	return f.market, nil
}

func (f *fakeStore) CreateMarket(ctx context.Context, req models.CreateMarketRequest) (models.Market, error) {
	if strings.TrimSpace(req.Question) == "" {
		return models.Market{}, mysqlstore.ErrInvalid
	}
	next := f.market
	next.ID = "created"
	next.Question = req.Question
	next.EndTime = req.EndTime
	next.AvatarURL = req.AvatarURL
	return next, nil
}

func (f *fakeStore) ListPositions(ctx context.Context, owner string) ([]models.Position, error) {
	return []models.Position{}, nil
}

func (f *fakeStore) ListActivity(ctx context.Context, marketID string, limit int) ([]models.AgentActivity, error) {
	return []models.AgentActivity{}, nil
}

func (f *fakeStore) RecordTrade(ctx context.Context, req models.TradeRequest) (models.TradeResponse, error) {
	f.recordCalled = true
	if req.MarketID == "" {
		return models.TradeResponse{}, mysqlstore.ErrInvalid
	}
	return models.TradeResponse{
		Signature: "indexed",
		Status:    "indexed",
		Market:    f.market,
		Position:  models.Position{ID: "pos_1", MarketID: req.MarketID, Side: req.Side, Size: req.AmountSOL},
		Activity:  models.AgentActivity{ID: "act_1", Agent: "You", MarketID: req.MarketID, Side: req.Side, Action: "BUY", Size: req.AmountSOL * 1000, Confidence: 99},
	}, nil
}

type fakeVerifier struct {
	err   error
	calls int
}

func (f *fakeVerifier) VerifyTrade(ctx context.Context, req models.TradeRequest) error {
	f.calls++
	return f.err
}

func TestBootstrap(t *testing.T) {
	handler := NewServer(&fakeStore{market: testMarket()}, []string{"http://localhost:3000"}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/api/bootstrap?owner=local", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}
	if got := res.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Fatalf("unexpected CORS origin %q", got)
	}

	var payload models.Bootstrap
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Markets) != 1 || payload.Markets[0].ID != "fed-rates" {
		t.Fatalf("unexpected markets payload: %+v", payload.Markets)
	}
}

func TestMarketNotFound(t *testing.T) {
	handler := NewServer(&fakeStore{market: testMarket()}, nil).Routes()

	req := httptest.NewRequest(http.MethodGet, "/api/markets/missing", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", res.Code, res.Body.String())
	}
}

func TestRecordTrade(t *testing.T) {
	handler := NewServer(&fakeStore{market: testMarket()}, nil).Routes()
	body := strings.NewReader(`{"marketId":"fed-rates","owner":"local","side":"YES","amountSol":1.5}`)

	req := httptest.NewRequest(http.MethodPost, "/api/trades", body)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d body=%s", res.Code, res.Body.String())
	}

	var payload models.TradeResponse
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Position.Size != 1.5 || payload.Activity.Action != "BUY" {
		t.Fatalf("unexpected trade response: %+v", payload)
	}
}

func TestCreateMarketWithAvatarURL(t *testing.T) {
	handler := NewServer(&fakeStore{market: testMarket()}, nil).Routes()
	body := strings.NewReader(`{"question":"Will SOL close above $250?","category":"Crypto","endTime":1893456000,"avatarUrl":"https://probx.site/avatar.png"}`)

	req := httptest.NewRequest(http.MethodPost, "/api/markets", body)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d body=%s", res.Code, res.Body.String())
	}

	var payload models.Market
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.AvatarURL != "https://probx.site/avatar.png" {
		t.Fatalf("unexpected avatar URL: %q", payload.AvatarURL)
	}
}

func TestRecordTradeVerifierBlocksInvalidTrade(t *testing.T) {
	store := &fakeStore{market: testMarket()}
	verifier := &fakeVerifier{err: chain.ErrVerificationFailed}
	handler := NewServerWithOptions(store, nil, Options{TradeVerifier: verifier}).Routes()
	body := strings.NewReader(`{"marketId":"fed-rates","owner":"local","side":"YES","amountSol":1.5,"signature":"bad"}`)

	req := httptest.NewRequest(http.MethodPost, "/api/trades", body)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", res.Code, res.Body.String())
	}
	if verifier.calls != 1 {
		t.Fatalf("expected verifier to be called once, got %d", verifier.calls)
	}
	if store.recordCalled {
		t.Fatalf("store should not record unverified trade")
	}
}

func TestRecordTradeVerifierUnavailable(t *testing.T) {
	store := &fakeStore{market: testMarket()}
	verifier := &fakeVerifier{err: chain.ErrVerifierUnavailable}
	handler := NewServerWithOptions(store, nil, Options{TradeVerifier: verifier}).Routes()
	body := strings.NewReader(`{"marketId":"fed-rates","owner":"local","side":"YES","amountSol":1.5,"signature":"sig"}`)

	req := httptest.NewRequest(http.MethodPost, "/api/trades", body)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d body=%s", res.Code, res.Body.String())
	}
	if store.recordCalled {
		t.Fatalf("store should not record trade when verifier is unavailable")
	}
}

func TestStoreErrorMapping(t *testing.T) {
	tests := []struct {
		err    error
		status int
	}{
		{mysqlstore.ErrInvalid, http.StatusBadRequest},
		{mysqlstore.ErrNotFound, http.StatusNotFound},
		{errors.New("boom"), http.StatusInternalServerError},
	}

	for _, tt := range tests {
		res := httptest.NewRecorder()
		writeStoreError(res, tt.err)
		if res.Code != tt.status {
			t.Fatalf("expected %d for %v, got %d", tt.status, tt.err, res.Code)
		}
	}
}

func testMarket() models.Market {
	return models.Market{
		ID:                 "fed-rates",
		PublicKey:          "market-public-key",
		Creator:            "creator",
		EndTime:            1_893_456_000,
		Question:           "Will rates be cut?",
		Category:           "Politics",
		YesPool:            60,
		NoPool:             40,
		TotalLiquidity:     100,
		Volume24h:          1000,
		Participants:       12,
		Change24h:          0.01,
		ProbabilityHistory: []float64{0.5, 0.6},
	}
}
