package main

import (
	"log"
	"net/http"
	"time"

	"probx/backend/internal/api"
	"probx/backend/internal/chain"
	"probx/backend/internal/config"
	"probx/backend/internal/mysqlstore"
)

func main() {
	cfg := config.Load()

	store, err := mysqlstore.Open(cfg.DatabaseDSN)
	if err != nil {
		log.Fatalf("open mysql: %v", err)
	}
	defer store.Close()

	options := api.Options{
		SolanaRPCURL:      cfg.SolanaRPCURL,
		ProgramID:         cfg.ProgramID,
		TradeVerification: cfg.TradeVerification,
	}
	switch cfg.TradeVerification {
	case "", "off":
	case "confirmed":
		verifier, err := chain.NewVerifier(cfg.SolanaRPCURL, cfg.ProgramID, 6*time.Second)
		if err != nil {
			log.Fatalf("configure trade verifier: %v", err)
		}
		options.TradeVerifier = verifier
		log.Printf("ProbX trade verification enabled against %s", cfg.SolanaRPCURL)
	default:
		log.Fatalf("unknown PROBX_TRADE_VERIFICATION mode %q", cfg.TradeVerification)
	}

	server := api.NewServerWithOptions(store, cfg.CORSOrigins, options)
	httpServer := &http.Server{
		Addr:    cfg.HTTPAddr,
		Handler: server.Routes(),
	}

	log.Printf("ProbX API listening on %s", cfg.HTTPAddr)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("listen: %v", err)
	}
}
