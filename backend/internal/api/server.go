package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"probx/backend/internal/chain"
	"probx/backend/internal/models"
	"probx/backend/internal/mysqlstore"
)

type Store interface {
	Ping(ctx context.Context) error
	Bootstrap(ctx context.Context, owner string) (models.Bootstrap, error)
	ListMarkets(ctx context.Context) ([]models.Market, error)
	GetMarket(ctx context.Context, id string) (models.Market, error)
	CreateMarket(ctx context.Context, req models.CreateMarketRequest) (models.Market, error)
	ListPositions(ctx context.Context, owner string) ([]models.Position, error)
	ListActivity(ctx context.Context, marketID string, limit int) ([]models.AgentActivity, error)
	RecordTrade(ctx context.Context, req models.TradeRequest) (models.TradeResponse, error)
	ResolveMarket(ctx context.Context, marketID string, req models.ResolveMarketRequest) (models.Market, error)
	RedeemPosition(ctx context.Context, positionID string, req models.RedeemPositionRequest) (models.RedeemPositionResponse, error)
}

type TradeVerifier interface {
	VerifyCreateMarket(ctx context.Context, req models.CreateMarketRequest) error
	VerifyTrade(ctx context.Context, req models.TradeRequest) error
	VerifyResolve(ctx context.Context, req models.ResolveMarketRequest) error
	VerifyRedeem(ctx context.Context, req models.RedeemPositionRequest) error
}

type Options struct {
	TradeVerifier     TradeVerifier
	SolanaRPCURL      string
	ProgramID         string
	TradeVerification string
}

type Server struct {
	store             Store
	tradeVerifier     TradeVerifier
	solanaRPCURL      string
	programID         string
	tradeVerification string
	corsOrigin        map[string]struct{}
	allowAll          bool
}

func NewServer(store Store, origins []string) *Server {
	return NewServerWithOptions(store, origins, Options{})
}

func NewServerWithOptions(store Store, origins []string, options Options) *Server {
	originSet := map[string]struct{}{}
	allowAll := false
	for _, origin := range origins {
		origin = strings.TrimSpace(origin)
		if origin == "*" {
			allowAll = true
			continue
		}
		if origin != "" {
			originSet[origin] = struct{}{}
		}
	}
	tradeVerification := strings.TrimSpace(strings.ToLower(options.TradeVerification))
	if tradeVerification == "" {
		if options.TradeVerifier != nil {
			tradeVerification = "confirmed"
		} else {
			tradeVerification = "off"
		}
	}
	return &Server{
		store:             store,
		tradeVerifier:     options.TradeVerifier,
		solanaRPCURL:      strings.TrimSpace(options.SolanaRPCURL),
		programID:         strings.TrimSpace(options.ProgramID),
		tradeVerification: tradeVerification,
		corsOrigin:        originSet,
		allowAll:          allowAll,
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)
	mux.HandleFunc("GET /api/status", s.status)
	mux.HandleFunc("GET /api/bootstrap", s.bootstrap)
	mux.HandleFunc("GET /api/markets", s.markets)
	mux.HandleFunc("POST /api/markets", s.createMarket)
	mux.HandleFunc("GET /api/markets/{id}", s.market)
	mux.HandleFunc("POST /api/markets/{id}/resolve", s.resolveMarket)
	mux.HandleFunc("GET /api/positions", s.positions)
	mux.HandleFunc("POST /api/positions/{id}/redeem", s.redeemPosition)
	mux.HandleFunc("GET /api/activity", s.activity)
	mux.HandleFunc("POST /api/trades", s.recordTrade)
	return s.withCORS(s.withLogging(mux))
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := requestContext(r)
	defer cancel()
	if err := s.store.Ping(ctx); err != nil {
		writeError(w, http.StatusServiceUnavailable, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) status(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := requestContext(r)
	defer cancel()

	dbOK := true
	dbError := ""
	if err := s.store.Ping(ctx); err != nil {
		dbOK = false
		dbError = err.Error()
	}

	markets, err := s.store.ListMarkets(ctx)
	if err != nil {
		dbOK = false
		if dbError == "" {
			dbError = err.Error()
		}
		markets = nil
	}

	origins := make([]string, 0, len(s.corsOrigin))
	for origin := range s.corsOrigin {
		origins = append(origins, origin)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                dbOK,
		"database":          map[string]any{"ok": dbOK, "error": dbError},
		"marketCount":       len(markets),
		"solanaRpcUrl":      s.solanaRPCURL,
		"programId":         s.programID,
		"tradeVerification": s.tradeVerification,
		"corsOrigins":       origins,
		"corsAllowAll":      s.allowAll,
	})
}

func (s *Server) bootstrap(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := requestContext(r)
	defer cancel()
	payload, err := s.store.Bootstrap(ctx, r.URL.Query().Get("owner"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) markets(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := requestContext(r)
	defer cancel()
	markets, err := s.store.ListMarkets(ctx)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, markets)
}

func (s *Server) market(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := requestContext(r)
	defer cancel()
	market, err := s.store.GetMarket(ctx, r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, market)
}

func (s *Server) createMarket(w http.ResponseWriter, r *http.Request) {
	var req models.CreateMarketRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	ctx, cancel := requestContext(r)
	defer cancel()
	if s.tradeVerifier != nil {
		if err := s.tradeVerifier.VerifyCreateMarket(ctx, req); err != nil {
			writeVerificationError(w, err)
			return
		}
	}
	market, err := s.store.CreateMarket(ctx, req)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, market)
}

func (s *Server) positions(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := requestContext(r)
	defer cancel()
	positions, err := s.store.ListPositions(ctx, r.URL.Query().Get("owner"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, positions)
}

func (s *Server) activity(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := requestContext(r)
	defer cancel()
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := s.store.ListActivity(ctx, r.URL.Query().Get("marketId"), limit)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) recordTrade(w http.ResponseWriter, r *http.Request) {
	var req models.TradeRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	ctx, cancel := requestContext(r)
	defer cancel()

	market, err := s.store.GetMarket(ctx, strings.TrimSpace(req.MarketID))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	req.MarketPublicKey = market.PublicKey

	if s.tradeVerifier != nil {
		if err := s.tradeVerifier.VerifyTrade(ctx, req); err != nil {
			writeVerificationError(w, err)
			return
		}
	}
	response, err := s.store.RecordTrade(ctx, req)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, response)
}

func (s *Server) resolveMarket(w http.ResponseWriter, r *http.Request) {
	var req models.ResolveMarketRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	ctx, cancel := requestContext(r)
	defer cancel()
	marketID := r.PathValue("id")
	if s.tradeVerifier != nil {
		market, err := s.store.GetMarket(ctx, strings.TrimSpace(marketID))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		req.MarketPublicKey = market.PublicKey
		if err := s.tradeVerifier.VerifyResolve(ctx, req); err != nil {
			writeVerificationError(w, err)
			return
		}
	}
	market, err := s.store.ResolveMarket(ctx, marketID, req)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, market)
}

func (s *Server) redeemPosition(w http.ResponseWriter, r *http.Request) {
	var req models.RedeemPositionRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	ctx, cancel := requestContext(r)
	defer cancel()
	positionID := r.PathValue("id")
	if s.tradeVerifier != nil {
		position, market, err := s.positionMarket(ctx, positionID, req.Owner)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		_ = position
		req.MarketPublicKey = market.PublicKey
		if err := s.tradeVerifier.VerifyRedeem(ctx, req); err != nil {
			writeVerificationError(w, err)
			return
		}
	}
	response, err := s.store.RedeemPosition(ctx, positionID, req)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) positionMarket(ctx context.Context, positionID string, owner string) (models.Position, models.Market, error) {
	positions, err := s.store.ListPositions(ctx, owner)
	if err != nil {
		return models.Position{}, models.Market{}, err
	}
	for _, position := range positions {
		if position.ID != positionID {
			continue
		}
		market, err := s.store.GetMarket(ctx, position.MarketID)
		if err != nil {
			return models.Position{}, models.Market{}, err
		}
		return position, market, nil
	}
	return models.Position{}, models.Market{}, mysqlstore.ErrNotFound
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if s.allowAll && origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		} else if _, ok := s.corsOrigin[origin]; ok {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
	})
}

func requestContext(r *http.Request) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), 8*time.Second)
}

func readJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	return decoder.Decode(dst)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, mysqlstore.ErrNotFound):
		writeError(w, http.StatusNotFound, err)
	case errors.Is(err, mysqlstore.ErrInvalid):
		writeError(w, http.StatusBadRequest, err)
	default:
		writeError(w, http.StatusInternalServerError, err)
	}
}

func writeVerificationError(w http.ResponseWriter, err error) {
	if errors.Is(err, chain.ErrVerifierUnavailable) {
		writeError(w, http.StatusServiceUnavailable, err)
		return
	}
	writeError(w, http.StatusBadRequest, err)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
