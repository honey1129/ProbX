package api

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"mime"
	"net/http"
	"os"
	"path/filepath"
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
	UpdateMarketMetadata(ctx context.Context, marketID string, req models.UpdateMarketMetadataRequest) (models.Market, error)
	ListPositions(ctx context.Context, owner string) ([]models.Position, error)
	ListActivity(ctx context.Context, marketID string, limit int) ([]models.AgentActivity, error)
	ListTrades(ctx context.Context, filter models.TradeFilter) (models.TradePage, error)
	GetIndexerCursor(ctx context.Context, name string) (models.IndexerCursor, error)
	ListIndexedEvents(ctx context.Context, filter models.IndexedEventFilter) ([]models.IndexedEventRecord, error)
	RecordTrade(ctx context.Context, req models.TradeRequest) (models.TradeResponse, error)
	SetMarketResolver(ctx context.Context, marketID string, req models.SetMarketResolverRequest) (models.Market, error)
	CancelMarket(ctx context.Context, marketID string, req models.CancelMarketRequest) (models.Market, error)
	ResolveMarket(ctx context.Context, marketID string, req models.ResolveMarketRequest) (models.Market, error)
	RedeemPosition(ctx context.Context, positionID string, req models.RedeemPositionRequest) (models.RedeemPositionResponse, error)
	RefundPosition(ctx context.Context, positionID string, req models.RefundPositionRequest) (models.RedeemPositionResponse, error)
	WithdrawResidual(ctx context.Context, marketID string, req models.WithdrawResidualRequest) (models.RedeemPositionResponse, error)
}

type TradeVerifier interface {
	VerifyCreateMarket(ctx context.Context, req models.CreateMarketRequest) error
	VerifyTrade(ctx context.Context, req models.TradeRequest) error
	VerifySetResolver(ctx context.Context, req models.SetMarketResolverRequest) error
	VerifyCancel(ctx context.Context, req models.CancelMarketRequest) error
	VerifyResolve(ctx context.Context, req models.ResolveMarketRequest) error
	VerifyRedeem(ctx context.Context, req models.RedeemPositionRequest) error
	VerifyRefund(ctx context.Context, req models.RefundPositionRequest) error
	VerifyWithdrawResidual(ctx context.Context, req models.WithdrawResidualRequest) error
}

type Options struct {
	TradeVerifier     TradeVerifier
	SolanaRPCURL      string
	ProgramID         string
	TradeVerification string
	MediaDir          string
	PublicBaseURL     string
}

type Server struct {
	store             Store
	tradeVerifier     TradeVerifier
	solanaRPCURL      string
	programID         string
	tradeVerification string
	mediaDir          string
	publicBaseURL     string
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
		mediaDir:          strings.TrimSpace(options.MediaDir),
		publicBaseURL:     strings.TrimRight(strings.TrimSpace(options.PublicBaseURL), "/"),
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
	mux.HandleFunc("PATCH /api/markets/{id}/metadata", s.updateMarketMetadata)
	mux.HandleFunc("POST /api/markets/{id}/resolver", s.setMarketResolver)
	mux.HandleFunc("POST /api/markets/{id}/cancel", s.cancelMarket)
	mux.HandleFunc("POST /api/markets/{id}/resolve", s.resolveMarket)
	mux.HandleFunc("POST /api/markets/{id}/withdraw-residual", s.withdrawResidual)
	mux.HandleFunc("GET /api/positions", s.positions)
	mux.HandleFunc("POST /api/positions/{id}/redeem", s.redeemPosition)
	mux.HandleFunc("POST /api/positions/{id}/refund", s.refundPosition)
	mux.HandleFunc("GET /api/activity", s.activity)
	mux.HandleFunc("GET /api/trades", s.trades)
	mux.HandleFunc("GET /api/indexed-events", s.indexedEvents)
	mux.HandleFunc("POST /api/trades", s.recordTrade)
	mux.HandleFunc("POST /api/media", s.uploadMedia)
	if s.mediaDir != "" {
		mux.Handle("GET /media/", http.StripPrefix("/media/", http.FileServer(http.Dir(s.mediaDir))))
	}
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

	indexerCursor, cursorErr := s.store.GetIndexerCursor(ctx, models.ProgramEventsCursorName)
	if cursorErr != nil {
		dbOK = false
		if dbError == "" {
			dbError = cursorErr.Error()
		}
	}
	indexerLagSeconds := int64(0)
	if indexerCursor.UpdatedAt > 0 {
		indexerLagSeconds = max(0, time.Now().UnixMilli()-indexerCursor.UpdatedAt) / 1000
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
		"indexer": map[string]any{
			"cursor":     indexerCursor,
			"lagSeconds": indexerLagSeconds,
		},
		"corsOrigins":  origins,
		"corsAllowAll": s.allowAll,
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

func (s *Server) updateMarketMetadata(w http.ResponseWriter, r *http.Request) {
	var req models.UpdateMarketMetadataRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	ctx, cancel := requestContext(r)
	defer cancel()

	marketID := r.PathValue("id")
	market, err := s.store.GetMarket(ctx, strings.TrimSpace(marketID))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if err := s.authorizeMarketMetadataUpdate(market, req); err != nil {
		if errors.Is(err, mysqlstore.ErrInvalid) {
			writeError(w, http.StatusBadRequest, err)
		} else {
			writeError(w, http.StatusUnauthorized, err)
		}
		return
	}

	updated, err := s.store.UpdateMarketMetadata(ctx, marketID, req)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
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

func (s *Server) trades(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := requestContext(r)
	defer cancel()
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	page, err := s.store.ListTrades(ctx, models.TradeFilter{
		Owner:     r.URL.Query().Get("owner"),
		MarketID:  r.URL.Query().Get("marketId"),
		Signature: r.URL.Query().Get("signature"),
		Side:      r.URL.Query().Get("side"),
		Action:    r.URL.Query().Get("action"),
		Status:    r.URL.Query().Get("status"),
		Limit:     limit,
		Cursor:    r.URL.Query().Get("cursor"),
	})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) indexedEvents(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := requestContext(r)
	defer cancel()
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	events, err := s.store.ListIndexedEvents(ctx, models.IndexedEventFilter{
		Signature: r.URL.Query().Get("signature"),
		Type:      r.URL.Query().Get("type"),
		Limit:     limit,
	})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
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

func (s *Server) uploadMedia(w http.ResponseWriter, r *http.Request) {
	if s.mediaDir == "" {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("media uploads are not configured"))
		return
	}
	if err := r.ParseMultipartForm(6 << 20); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid media upload"))
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("file is required"))
		return
	}
	defer file.Close()

	contentType := header.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "image/") {
		writeError(w, http.StatusBadRequest, fmt.Errorf("file must be an image"))
		return
	}
	if header.Size > 5<<20 {
		writeError(w, http.StatusBadRequest, fmt.Errorf("image must be under 5 MB"))
		return
	}
	extension := extensionForContentType(contentType)
	if extension == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("unsupported image type"))
		return
	}
	if err := os.MkdirAll(s.mediaDir, 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("media storage unavailable"))
		return
	}
	name, err := randomMediaName(extension)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("media storage unavailable"))
		return
	}
	path := filepath.Join(s.mediaDir, name)
	out, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("media storage unavailable"))
		return
	}
	defer out.Close()

	limited := io.LimitReader(file, 5<<20+1)
	written, err := io.Copy(out, limited)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("media storage unavailable"))
		return
	}
	if written > 5<<20 {
		_ = out.Close()
		_ = os.Remove(path)
		writeError(w, http.StatusBadRequest, fmt.Errorf("image must be under 5 MB"))
		return
	}

	urlPath := "/media/" + name
	url := urlPath
	if s.publicBaseURL != "" {
		url = s.publicBaseURL + urlPath
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"url":         url,
		"path":        urlPath,
		"contentType": contentType,
		"size":        written,
	})
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

func (s *Server) setMarketResolver(w http.ResponseWriter, r *http.Request) {
	var req models.SetMarketResolverRequest
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
		if err := s.tradeVerifier.VerifySetResolver(ctx, req); err != nil {
			writeVerificationError(w, err)
			return
		}
	}
	market, err := s.store.SetMarketResolver(ctx, marketID, req)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, market)
}

func (s *Server) cancelMarket(w http.ResponseWriter, r *http.Request) {
	var req models.CancelMarketRequest
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
		if err := s.tradeVerifier.VerifyCancel(ctx, req); err != nil {
			writeVerificationError(w, err)
			return
		}
	}
	market, err := s.store.CancelMarket(ctx, marketID, req)
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

func (s *Server) refundPosition(w http.ResponseWriter, r *http.Request) {
	var req models.RefundPositionRequest
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
		if err := s.tradeVerifier.VerifyRefund(ctx, req); err != nil {
			writeVerificationError(w, err)
			return
		}
	}
	response, err := s.store.RefundPosition(ctx, positionID, req)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) withdrawResidual(w http.ResponseWriter, r *http.Request) {
	var req models.WithdrawResidualRequest
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
		if err := s.tradeVerifier.VerifyWithdrawResidual(ctx, req); err != nil {
			writeVerificationError(w, err)
			return
		}
	}
	response, err := s.store.WithdrawResidual(ctx, marketID, req)
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

func (s *Server) authorizeMarketMetadataUpdate(market models.Market, req models.UpdateMarketMetadataRequest) error {
	actor := strings.TrimSpace(req.Actor)
	if actor == "" {
		return fmt.Errorf("%w: actor is required", mysqlstore.ErrInvalid)
	}
	if actor != strings.TrimSpace(market.Creator) {
		return fmt.Errorf("metadata update is only allowed by the market creator")
	}
	if s.tradeVerification != "confirmed" {
		return nil
	}
	message := strings.TrimSpace(req.Message)
	signature := strings.TrimSpace(req.Signature)
	if message == "" || signature == "" {
		return fmt.Errorf("%w: wallet signature is required", mysqlstore.ErrInvalid)
	}
	expectedMessage := marketMetadataMessage(market.ID, actor, req.Category, req.AvatarURL)
	if message != expectedMessage {
		return fmt.Errorf("%w: metadata signature message mismatch", mysqlstore.ErrInvalid)
	}
	publicKey, err := base58Decode(actor)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return fmt.Errorf("%w: invalid actor public key", mysqlstore.ErrInvalid)
	}
	rawSignature, err := base58Decode(signature)
	if err != nil || len(rawSignature) != ed25519.SignatureSize {
		return fmt.Errorf("%w: invalid wallet signature", mysqlstore.ErrInvalid)
	}
	if !ed25519.Verify(ed25519.PublicKey(publicKey), []byte(message), rawSignature) {
		return fmt.Errorf("wallet signature verification failed")
	}
	return nil
}

func marketMetadataMessage(marketID string, actor string, category string, avatarURL string) string {
	return strings.Join([]string{
		"ProbX metadata update",
		"market=" + strings.TrimSpace(marketID),
		"actor=" + strings.TrimSpace(actor),
		"category=" + strings.TrimSpace(category),
		"avatarUrl=" + strings.TrimSpace(avatarURL),
	}, "\n")
}

func extensionForContentType(contentType string) string {
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		mediaType = contentType
	}
	switch strings.ToLower(mediaType) {
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "image/svg+xml":
		return ".svg"
	default:
		return ""
	}
}

func randomMediaName(extension string) (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]) + extension, nil
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
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS")
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
	return context.WithTimeout(r.Context(), 30*time.Second)
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

func base58Decode(input string) ([]byte, error) {
	const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
	indexes := map[rune]int64{}
	for i, char := range alphabet {
		indexes[char] = int64(i)
	}

	value := big.NewInt(0)
	base := big.NewInt(58)
	for _, char := range input {
		index, ok := indexes[char]
		if !ok {
			return nil, fmt.Errorf("invalid base58 character %q", char)
		}
		value.Mul(value, base)
		value.Add(value, big.NewInt(index))
	}

	decoded := value.Bytes()
	leadingZeroes := 0
	for _, char := range input {
		if char != rune(alphabet[0]) {
			break
		}
		leadingZeroes++
	}
	if leadingZeroes > 0 {
		decoded = append(make([]byte, leadingZeroes), decoded...)
	}
	return decoded, nil
}
