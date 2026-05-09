package main

import (
	"context"
	"log"
	"time"

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

	client, err := chain.NewAccountClient(cfg.SolanaRPCURL, cfg.ProgramID, 10*time.Second)
	if err != nil {
		log.Fatalf("configure Solana account client: %v", err)
	}
	log.Printf("ProbX indexer using rpc=%s program=%s", cfg.SolanaRPCURL, cfg.ProgramID)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	markets, err := client.FetchMarkets(ctx)
	if err != nil {
		log.Fatalf("fetch on-chain markets: %v", err)
	}

	for _, account := range markets {
		market, err := store.UpsertIndexedMarket(ctx, account.Model())
		if err != nil {
			log.Fatalf("upsert market %s: %v", account.PublicKey, err)
		}
		log.Printf("indexed market id=%s publicKey=%s question=%q", market.ID, market.PublicKey, market.Question)
	}

	positions, err := client.FetchPositions(ctx)
	if err != nil {
		log.Fatalf("fetch on-chain positions: %v", err)
	}
	indexedPositions := 0
	for _, account := range positions {
		if err := store.UpsertIndexedPosition(ctx, account.Model()); err != nil {
			log.Fatalf("upsert position %s: %v", account.PublicKey, err)
		}
		indexedPositions++
	}

	events, err := client.FetchRecentEvents(ctx, 200)
	if err != nil {
		log.Fatalf("fetch recent program events: %v", err)
	}
	indexedEvents := 0
	skippedEvents := 0
	for _, event := range events {
		inserted, err := store.IndexProgramEvent(ctx, event.Model())
		if err != nil {
			log.Fatalf("index event %s type=%s: %v", event.ID, event.Type, err)
		}
		if inserted {
			indexedEvents++
		} else {
			skippedEvents++
		}
	}

	log.Printf(
		"indexed %d market account(s), %d position account(s), %d new event(s), %d duplicate event(s)",
		len(markets),
		indexedPositions,
		indexedEvents,
		skippedEvents,
	)
}
