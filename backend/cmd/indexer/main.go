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
	log.Printf("indexed %d market account(s)", len(markets))
}
