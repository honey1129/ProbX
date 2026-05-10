package main

import (
	"context"
	"log"
	"time"

	"probx/backend/internal/chain"
	"probx/backend/internal/config"
	"probx/backend/internal/models"
	"probx/backend/internal/mysqlstore"
)

const programEventsCursorName = "program_events"

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

	cursor, err := store.GetIndexerCursor(ctx, programEventsCursorName)
	if err != nil {
		log.Fatalf("load indexer cursor: %v", err)
	}
	result, err := client.FetchEvents(ctx, chain.EventFetchOptions{
		Limit:          5000,
		PageSize:       200,
		UntilSignature: cursor.Signature,
	})
	if err != nil {
		log.Fatalf("fetch program events: %v", err)
	}
	events := result.Events
	signatures := result.Signatures
	indexedEvents := 0
	skippedEvents := 0
	nextCursor := cursor
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
	if len(signatures) > 0 && result.Complete {
		newest := signatures[0]
		nextCursor = models.IndexerCursor{
			Signature: newest.Signature,
			Slot:      newest.Slot,
		}
		if err := store.SaveIndexerCursor(ctx, programEventsCursorName, nextCursor); err != nil {
			log.Fatalf("save indexer cursor: %v", err)
		}
	} else if len(signatures) > 0 {
		log.Printf("program event backlog exceeded fetch limit; processed %d signature(s) without advancing cursor", len(signatures))
	}

	log.Printf(
		"indexed %d market account(s), %d position account(s), %d new event(s), %d duplicate event(s), cursor=%q->%q complete=%t",
		len(markets),
		indexedPositions,
		indexedEvents,
		skippedEvents,
		cursor.Signature,
		nextCursor.Signature,
		result.Complete,
	)
}
