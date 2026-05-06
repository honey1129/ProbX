package main

import (
	"log"
	"net/http"

	"probx/backend/internal/api"
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

	server := api.NewServer(store, cfg.CORSOrigins)
	httpServer := &http.Server{
		Addr:    cfg.HTTPAddr,
		Handler: server.Routes(),
	}

	log.Printf("ProbX API listening on %s", cfg.HTTPAddr)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("listen: %v", err)
	}
}
