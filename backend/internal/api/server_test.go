package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"probx/backend/internal/chain"
	"probx/backend/internal/models"
	"probx/backend/internal/mysqlstore"
)

type fakeStore struct {
	market            models.Market
	createCalled      bool
	recordCalled      bool
	setResolverCalled bool
	cancelCalled      bool
	resolveCalled     bool
	redeemCalled      bool
	refundCalled      bool
	withdrawCalled    bool
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
	f.createCalled = true
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

func (f *fakeStore) UpdateMarketMetadata(ctx context.Context, marketID string, req models.UpdateMarketMetadataRequest) (models.Market, error) {
	if marketID != f.market.ID {
		return models.Market{}, mysqlstore.ErrNotFound
	}
	next := f.market
	next.Category = req.Category
	next.AvatarURL = req.AvatarURL
	return next, nil
}

func (f *fakeStore) ListPositions(ctx context.Context, owner string) ([]models.Position, error) {
	if owner == "" || owner == "local" || owner == "owner_123" {
		return []models.Position{
			{ID: "pos_1", MarketID: f.market.ID, Side: "YES", Size: 1, EntryProbability: 0.5, CurrentProbability: 0.6, PnL: 10},
		}, nil
	}
	return []models.Position{}, nil
}

func (f *fakeStore) ListActivity(ctx context.Context, marketID string, limit int) ([]models.AgentActivity, error) {
	return []models.AgentActivity{}, nil
}

func (f *fakeStore) ListTrades(ctx context.Context, filter models.TradeFilter) (models.TradePage, error) {
	return models.TradePage{
		Trades: []models.Trade{
			{
				ID:        "trade_1",
				Owner:     normalizeTestOwner(filter.Owner),
				MarketID:  f.market.ID,
				Side:      "YES",
				Action:    "BUY",
				AmountSOL: 1.5,
				Price:     0.6,
				Signature: "sig_1",
				Status:    "confirmed",
				CreatedAt: 1234,
			},
		},
	}, nil
}

func (f *fakeStore) GetIndexerCursor(ctx context.Context, name string) (models.IndexerCursor, error) {
	if name != models.ProgramEventsCursorName {
		return models.IndexerCursor{}, mysqlstore.ErrNotFound
	}
	return models.IndexerCursor{Signature: "cursor_sig", Slot: 42, UpdatedAt: 1}, nil
}

func (f *fakeStore) ListIndexedEvents(ctx context.Context, filter models.IndexedEventFilter) ([]models.IndexedEventRecord, error) {
	return []models.IndexedEventRecord{
		{ID: "sig_1_0", Signature: filter.Signature, Slot: 42, Type: normalizeTestEventType(filter.Type), CreatedAt: 1234},
	}, nil
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

func (f *fakeStore) ResolveMarket(ctx context.Context, marketID string, req models.ResolveMarketRequest) (models.Market, error) {
	f.resolveCalled = true
	if marketID != f.market.ID {
		return models.Market{}, mysqlstore.ErrNotFound
	}
	next := f.market
	next.Resolved = true
	next.Outcome = &req.Outcome
	return next, nil
}

func (f *fakeStore) SetMarketResolver(ctx context.Context, marketID string, req models.SetMarketResolverRequest) (models.Market, error) {
	f.setResolverCalled = true
	if marketID != f.market.ID {
		return models.Market{}, mysqlstore.ErrNotFound
	}
	next := f.market
	next.Resolver = req.NewResolver
	return next, nil
}

func (f *fakeStore) CancelMarket(ctx context.Context, marketID string, req models.CancelMarketRequest) (models.Market, error) {
	f.cancelCalled = true
	if marketID != f.market.ID {
		return models.Market{}, mysqlstore.ErrNotFound
	}
	next := f.market
	outcome := 2
	next.Resolved = true
	next.Outcome = &outcome
	return next, nil
}

func (f *fakeStore) RedeemPosition(ctx context.Context, positionID string, req models.RedeemPositionRequest) (models.RedeemPositionResponse, error) {
	f.redeemCalled = true
	if positionID != "pos_1" {
		return models.RedeemPositionResponse{}, mysqlstore.ErrNotFound
	}
	position := models.Position{ID: positionID, MarketID: f.market.ID, Side: "YES", Size: 0, Resolved: true}
	return models.RedeemPositionResponse{
		Signature: "indexed",
		Status:    "indexed",
		Market:    f.market,
		Position:  position,
	}, nil
}

func (f *fakeStore) RefundPosition(ctx context.Context, positionID string, req models.RefundPositionRequest) (models.RedeemPositionResponse, error) {
	f.refundCalled = true
	if positionID != "pos_1" {
		return models.RedeemPositionResponse{}, mysqlstore.ErrNotFound
	}
	position := models.Position{ID: positionID, MarketID: f.market.ID, Side: "YES", Size: 0, Resolved: true}
	return models.RedeemPositionResponse{
		Signature: "indexed",
		Status:    "indexed",
		Market:    f.market,
		Position:  position,
	}, nil
}

func (f *fakeStore) WithdrawResidual(ctx context.Context, marketID string, req models.WithdrawResidualRequest) (models.RedeemPositionResponse, error) {
	f.withdrawCalled = true
	if marketID != f.market.ID {
		return models.RedeemPositionResponse{}, mysqlstore.ErrNotFound
	}
	next := f.market
	next.ResidualClaimed = true
	next.ResidualWithdrawn = next.TotalLiquidity
	next.TotalLiquidity = 0
	return models.RedeemPositionResponse{
		Signature: "indexed",
		Status:    "indexed",
		Market:    next,
	}, nil
}

type fakeVerifier struct {
	err              error
	createCalls      int
	calls            int
	setResolverCalls int
	cancelCalls      int
	resolveCalls     int
	redeemCalls      int
	refundCalls      int
	withdrawCalls    int
}

func (f *fakeVerifier) VerifyCreateMarket(ctx context.Context, req models.CreateMarketRequest) error {
	f.createCalls++
	return f.err
}

func (f *fakeVerifier) VerifyTrade(ctx context.Context, req models.TradeRequest) error {
	f.calls++
	return f.err
}

func (f *fakeVerifier) VerifyResolve(ctx context.Context, req models.ResolveMarketRequest) error {
	f.resolveCalls++
	return f.err
}

func (f *fakeVerifier) VerifySetResolver(ctx context.Context, req models.SetMarketResolverRequest) error {
	f.setResolverCalls++
	return f.err
}

func (f *fakeVerifier) VerifyCancel(ctx context.Context, req models.CancelMarketRequest) error {
	f.cancelCalls++
	return f.err
}

func (f *fakeVerifier) VerifyRedeem(ctx context.Context, req models.RedeemPositionRequest) error {
	f.redeemCalls++
	return f.err
}

func (f *fakeVerifier) VerifyRefund(ctx context.Context, req models.RefundPositionRequest) error {
	f.refundCalls++
	return f.err
}

func (f *fakeVerifier) VerifyWithdrawResidual(ctx context.Context, req models.WithdrawResidualRequest) error {
	f.withdrawCalls++
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

func TestStatusReportsRuntimeConfig(t *testing.T) {
	const (
		rpcURL    = "https://api.devnet.solana.com"
		programID = "4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL"
	)
	handler := NewServerWithOptions(
		&fakeStore{market: testMarket()},
		[]string{"https://probx.site", "https://www.probx.site"},
		Options{
			SolanaRPCURL:      rpcURL,
			ProgramID:         programID,
			TradeVerification: "confirmed",
		},
	).Routes()

	req := httptest.NewRequest(http.MethodGet, "/api/status", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}

	var payload struct {
		OK                bool     `json:"ok"`
		MarketCount       int      `json:"marketCount"`
		SolanaRPCURL      string   `json:"solanaRpcUrl"`
		ProgramID         string   `json:"programId"`
		TradeVerification string   `json:"tradeVerification"`
		CORSOrigins       []string `json:"corsOrigins"`
		CORSAllowAll      bool     `json:"corsAllowAll"`
		Indexer           struct {
			Cursor struct {
				Signature string `json:"signature"`
				Slot      uint64 `json:"slot"`
				UpdatedAt int64  `json:"updatedAt"`
			} `json:"cursor"`
			LagSeconds int64 `json:"lagSeconds"`
		} `json:"indexer"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if !payload.OK || payload.MarketCount != 1 {
		t.Fatalf("unexpected status payload: %+v", payload)
	}
	if payload.SolanaRPCURL != rpcURL || payload.ProgramID != programID {
		t.Fatalf("unexpected chain config: rpc=%q program=%q", payload.SolanaRPCURL, payload.ProgramID)
	}
	if payload.TradeVerification != "confirmed" {
		t.Fatalf("unexpected trade verification mode %q", payload.TradeVerification)
	}
	if payload.Indexer.Cursor.Signature != "cursor_sig" || payload.Indexer.Cursor.Slot != 42 || payload.Indexer.LagSeconds <= 0 {
		t.Fatalf("unexpected indexer payload: %+v", payload.Indexer)
	}
	if payload.CORSAllowAll {
		t.Fatalf("did not expect allow-all CORS")
	}
	if !contains(payload.CORSOrigins, "https://probx.site") || !contains(payload.CORSOrigins, "https://www.probx.site") {
		t.Fatalf("unexpected CORS origins: %+v", payload.CORSOrigins)
	}
}

func TestUploadMedia(t *testing.T) {
	mediaDir := t.TempDir()
	handler := NewServerWithOptions(
		&fakeStore{market: testMarket()},
		nil,
		Options{MediaDir: mediaDir, PublicBaseURL: "https://api.probx.site"},
	).Routes()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	partHeader := make(textproto.MIMEHeader)
	partHeader.Set("Content-Disposition", `form-data; name="file"; filename="avatar.png"`)
	partHeader.Set("Content-Type", "image/png")
	part, err := writer.CreatePart(partHeader)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write([]byte{0x89, 'P', 'N', 'G', '\r', '\n'}); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/media", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d body=%s", res.Code, res.Body.String())
	}

	var payload struct {
		URL         string `json:"url"`
		Path        string `json:"path"`
		ContentType string `json:"contentType"`
		Size        int64  `json:"size"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !strings.HasPrefix(payload.URL, "https://api.probx.site/media/") || !strings.HasPrefix(payload.Path, "/media/") {
		t.Fatalf("unexpected media URL payload: %+v", payload)
	}
	if payload.ContentType != "image/png" || payload.Size == 0 {
		t.Fatalf("unexpected media metadata: %+v", payload)
	}
	if _, err := os.Stat(filepath.Join(mediaDir, strings.TrimPrefix(payload.Path, "/media/"))); err != nil {
		t.Fatalf("expected media file on disk: %v", err)
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

func TestListTrades(t *testing.T) {
	handler := NewServer(&fakeStore{market: testMarket()}, nil).Routes()

	req := httptest.NewRequest(http.MethodGet, "/api/trades?marketId=fed-rates&owner=local&limit=25", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}

	var payload models.TradePage
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Trades) != 1 || payload.Trades[0].Action != "BUY" || payload.Trades[0].Status != "confirmed" {
		t.Fatalf("unexpected trades response: %+v", payload)
	}
}

func TestListIndexedEvents(t *testing.T) {
	handler := NewServer(&fakeStore{market: testMarket()}, nil).Routes()

	req := httptest.NewRequest(http.MethodGet, "/api/indexed-events?signature=sig_1&type=MarketCreated", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}

	var payload struct {
		Events []models.IndexedEventRecord `json:"events"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Events) != 1 || payload.Events[0].Type != "MarketCreated" {
		t.Fatalf("unexpected indexed event response: %+v", payload)
	}
}

func TestResolveMarket(t *testing.T) {
	handler := NewServer(&fakeStore{market: testMarket()}, nil).Routes()
	body := strings.NewReader(`{"resolver":"local","outcome":1}`)

	req := httptest.NewRequest(http.MethodPost, "/api/markets/fed-rates/resolve", body)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}

	var payload models.Market
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.Resolved || payload.Outcome == nil || *payload.Outcome != 1 {
		t.Fatalf("unexpected resolved market: %+v", payload)
	}
}

func TestSetMarketResolver(t *testing.T) {
	handler := NewServer(&fakeStore{market: testMarket()}, nil).Routes()
	body := strings.NewReader(`{"actor":"local","newResolver":"resolver_456"}`)

	req := httptest.NewRequest(http.MethodPost, "/api/markets/fed-rates/resolver", body)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}

	var payload models.Market
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Resolver != "resolver_456" {
		t.Fatalf("unexpected resolver update: %+v", payload)
	}
}

func TestCancelMarket(t *testing.T) {
	handler := NewServer(&fakeStore{market: testMarket()}, nil).Routes()
	body := strings.NewReader(`{"resolver":"local"}`)

	req := httptest.NewRequest(http.MethodPost, "/api/markets/fed-rates/cancel", body)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}

	var payload models.Market
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.Resolved || payload.Outcome == nil || *payload.Outcome != 2 {
		t.Fatalf("unexpected cancelled market: %+v", payload)
	}
}

func TestRedeemPosition(t *testing.T) {
	handler := NewServer(&fakeStore{market: testMarket()}, nil).Routes()
	body := strings.NewReader(`{"owner":"local"}`)

	req := httptest.NewRequest(http.MethodPost, "/api/positions/pos_1/redeem", body)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}

	var payload models.RedeemPositionResponse
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Position.ID != "pos_1" || payload.Position.Size != 0 {
		t.Fatalf("unexpected redeem response: %+v", payload)
	}
}

func TestRefundPosition(t *testing.T) {
	handler := NewServer(&fakeStore{market: testMarket()}, nil).Routes()
	body := strings.NewReader(`{"owner":"local"}`)

	req := httptest.NewRequest(http.MethodPost, "/api/positions/pos_1/refund", body)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}

	var payload models.RedeemPositionResponse
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Position.ID != "pos_1" || payload.Position.Size != 0 {
		t.Fatalf("unexpected refund response: %+v", payload)
	}
}

func TestWithdrawResidual(t *testing.T) {
	handler := NewServer(&fakeStore{market: testMarket()}, nil).Routes()
	body := strings.NewReader(`{"creator":"local"}`)

	req := httptest.NewRequest(http.MethodPost, "/api/markets/fed-rates/withdraw-residual", body)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}

	var payload models.RedeemPositionResponse
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.Market.ResidualClaimed || payload.Market.TotalLiquidity != 0 {
		t.Fatalf("unexpected withdraw response: %+v", payload)
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

func TestUpdateMarketMetadata(t *testing.T) {
	handler := NewServer(&fakeStore{market: testMarket()}, nil).Routes()
	body := strings.NewReader(`{"actor":"creator","category":"Sports","avatarUrl":"https://probx.site/sports.png"}`)

	req := httptest.NewRequest(http.MethodPatch, "/api/markets/fed-rates/metadata", body)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}

	var payload models.Market
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Category != "Sports" || payload.AvatarURL != "https://probx.site/sports.png" {
		t.Fatalf("unexpected metadata response: %+v", payload)
	}
}

func TestUpdateMarketMetadataBlocksNonCreator(t *testing.T) {
	handler := NewServer(&fakeStore{market: testMarket()}, nil).Routes()
	body := strings.NewReader(`{"actor":"not_creator","category":"Sports"}`)

	req := httptest.NewRequest(http.MethodPatch, "/api/markets/fed-rates/metadata", body)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", res.Code, res.Body.String())
	}
}

func TestCreateMarketVerifierBlocksInvalidCreation(t *testing.T) {
	store := &fakeStore{market: testMarket()}
	verifier := &fakeVerifier{err: chain.ErrVerificationFailed}
	handler := NewServerWithOptions(store, nil, Options{TradeVerifier: verifier}).Routes()
	body := strings.NewReader(`{"question":"Will SOL close above $250?","creator":"creator_123","publicKey":"market_123","endTime":1893456000,"initialLiquidity":2,"signature":"bad"}`)

	req := httptest.NewRequest(http.MethodPost, "/api/markets", body)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", res.Code, res.Body.String())
	}
	if verifier.createCalls != 1 {
		t.Fatalf("expected create verifier to be called once, got %d", verifier.createCalls)
	}
	if store.createCalled {
		t.Fatalf("store should not create unverified market")
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

func TestResolveMarketVerifierBlocksInvalidResolution(t *testing.T) {
	store := &fakeStore{market: testMarket()}
	verifier := &fakeVerifier{err: chain.ErrVerificationFailed}
	handler := NewServerWithOptions(store, nil, Options{TradeVerifier: verifier}).Routes()
	body := strings.NewReader(`{"resolver":"resolver_123","outcome":1,"signature":"bad"}`)

	req := httptest.NewRequest(http.MethodPost, "/api/markets/fed-rates/resolve", body)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", res.Code, res.Body.String())
	}
	if verifier.resolveCalls != 1 {
		t.Fatalf("expected resolve verifier to be called once, got %d", verifier.resolveCalls)
	}
	if store.resolveCalled {
		t.Fatalf("store should not resolve unverified market")
	}
}

func TestSetResolverVerifierBlocksInvalidUpdate(t *testing.T) {
	store := &fakeStore{market: testMarket()}
	verifier := &fakeVerifier{err: chain.ErrVerificationFailed}
	handler := NewServerWithOptions(store, nil, Options{TradeVerifier: verifier}).Routes()
	body := strings.NewReader(`{"actor":"resolver_123","newResolver":"resolver_456","signature":"bad"}`)

	req := httptest.NewRequest(http.MethodPost, "/api/markets/fed-rates/resolver", body)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", res.Code, res.Body.String())
	}
	if verifier.setResolverCalls != 1 {
		t.Fatalf("expected set resolver verifier to be called once, got %d", verifier.setResolverCalls)
	}
	if store.setResolverCalled {
		t.Fatalf("store should not update resolver for unverified transaction")
	}
}

func TestCancelMarketVerifierBlocksInvalidCancellation(t *testing.T) {
	store := &fakeStore{market: testMarket()}
	verifier := &fakeVerifier{err: chain.ErrVerificationFailed}
	handler := NewServerWithOptions(store, nil, Options{TradeVerifier: verifier}).Routes()
	body := strings.NewReader(`{"resolver":"resolver_123","signature":"bad"}`)

	req := httptest.NewRequest(http.MethodPost, "/api/markets/fed-rates/cancel", body)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", res.Code, res.Body.String())
	}
	if verifier.cancelCalls != 1 {
		t.Fatalf("expected cancel verifier to be called once, got %d", verifier.cancelCalls)
	}
	if store.cancelCalled {
		t.Fatalf("store should not cancel unverified market")
	}
}

func TestRedeemPositionVerifierBlocksInvalidRedemption(t *testing.T) {
	store := &fakeStore{market: testMarket()}
	verifier := &fakeVerifier{err: chain.ErrVerificationFailed}
	handler := NewServerWithOptions(store, nil, Options{TradeVerifier: verifier}).Routes()
	body := strings.NewReader(`{"owner":"owner_123","signature":"bad"}`)

	req := httptest.NewRequest(http.MethodPost, "/api/positions/pos_1/redeem", body)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", res.Code, res.Body.String())
	}
	if verifier.redeemCalls != 1 {
		t.Fatalf("expected redeem verifier to be called once, got %d", verifier.redeemCalls)
	}
	if store.redeemCalled {
		t.Fatalf("store should not redeem unverified position")
	}
}

func TestRefundPositionVerifierBlocksInvalidRefund(t *testing.T) {
	store := &fakeStore{market: testMarket()}
	verifier := &fakeVerifier{err: chain.ErrVerificationFailed}
	handler := NewServerWithOptions(store, nil, Options{TradeVerifier: verifier}).Routes()
	body := strings.NewReader(`{"owner":"owner_123","signature":"bad"}`)

	req := httptest.NewRequest(http.MethodPost, "/api/positions/pos_1/refund", body)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", res.Code, res.Body.String())
	}
	if verifier.refundCalls != 1 {
		t.Fatalf("expected refund verifier to be called once, got %d", verifier.refundCalls)
	}
	if store.refundCalled {
		t.Fatalf("store should not refund unverified position")
	}
}

func TestWithdrawResidualVerifierBlocksInvalidWithdrawal(t *testing.T) {
	store := &fakeStore{market: testMarket()}
	verifier := &fakeVerifier{err: chain.ErrVerificationFailed}
	handler := NewServerWithOptions(store, nil, Options{TradeVerifier: verifier}).Routes()
	body := strings.NewReader(`{"creator":"creator","signature":"bad"}`)

	req := httptest.NewRequest(http.MethodPost, "/api/markets/fed-rates/withdraw-residual", body)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", res.Code, res.Body.String())
	}
	if verifier.withdrawCalls != 1 {
		t.Fatalf("expected withdraw verifier to be called once, got %d", verifier.withdrawCalls)
	}
	if store.withdrawCalled {
		t.Fatalf("store should not withdraw residual funds for unverified transaction")
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

func normalizeTestOwner(owner string) string {
	if strings.TrimSpace(owner) == "" {
		return "local"
	}
	return owner
}

func normalizeTestEventType(eventType string) string {
	if strings.TrimSpace(eventType) == "" {
		return "MarketCreated"
	}
	return eventType
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func testMarket() models.Market {
	return models.Market{
		ID:                 "fed-rates",
		PublicKey:          "market-public-key",
		Creator:            "creator",
		Resolver:           "creator",
		ProtocolConfig:     "local",
		Treasury:           "creator",
		ProtocolFeeBps:     100,
		CreatorLPShares:    100,
		ProtocolFees:       1,
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
