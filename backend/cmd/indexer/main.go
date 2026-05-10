package main

import (
	"context"
	"fmt"
	"log"
	"os/signal"
	"syscall"
	"time"

	"probx/backend/internal/chain"
	"probx/backend/internal/config"
	"probx/backend/internal/models"
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
	log.Printf(
		"ProbX indexer using rpc=%s program=%s interval=%s timeout=%s eventLimit=%d",
		cfg.SolanaRPCURL,
		cfg.ProgramID,
		cfg.IndexerInterval,
		cfg.IndexerTimeout,
		cfg.IndexerEventLimit,
	)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if cfg.IndexerInterval <= 0 {
		if err := runOnce(ctx, store, client, cfg.IndexerTimeout, cfg.IndexerEventLimit); err != nil {
			log.Fatalf("index once: %v", err)
		}
		return
	}

	ticker := time.NewTicker(cfg.IndexerInterval)
	defer ticker.Stop()
	for {
		if err := runOnce(ctx, store, client, cfg.IndexerTimeout, cfg.IndexerEventLimit); err != nil {
			log.Printf("index cycle failed: %v", err)
		}

		select {
		case <-ctx.Done():
			log.Printf("ProbX indexer stopped")
			return
		case <-ticker.C:
		}
	}
}

func runOnce(parent context.Context, store *mysqlstore.Store, client *chain.AccountClient, timeout time.Duration, eventLimit int) error {
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	if eventLimit <= 0 {
		eventLimit = 5000
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	markets, err := client.FetchMarkets(ctx)
	if err != nil {
		return fmt.Errorf("fetch on-chain markets: %w", err)
	}

	for _, account := range markets {
		market, err := store.UpsertIndexedMarket(ctx, account.Model())
		if err != nil {
			return fmt.Errorf("upsert market %s: %w", account.PublicKey, err)
		}
		log.Printf("indexed market id=%s publicKey=%s question=%q", market.ID, market.PublicKey, market.Question)
	}

	positions, err := client.FetchPositions(ctx)
	if err != nil {
		return fmt.Errorf("fetch on-chain positions: %w", err)
	}
	indexedPositions := 0
	for _, account := range positions {
		if err := store.UpsertIndexedPosition(ctx, account.Model()); err != nil {
			return fmt.Errorf("upsert position %s: %w", account.PublicKey, err)
		}
		indexedPositions++
	}

	cursor, err := store.GetIndexerCursor(ctx, models.ProgramEventsCursorName)
	if err != nil {
		return fmt.Errorf("load indexer cursor: %w", err)
	}
	result, err := client.FetchEvents(ctx, chain.EventFetchOptions{
		Limit:          eventLimit,
		PageSize:       200,
		UntilSignature: cursor.Signature,
	})
	if err != nil {
		return fmt.Errorf("fetch program events: %w", err)
	}
	events := result.Events
	signatures := result.Signatures
	indexedEvents := 0
	skippedEvents := 0
	nextCursor := cursor
	for _, event := range events {
		inserted, err := store.IndexProgramEvent(ctx, event.Model())
		if err != nil {
			return fmt.Errorf("index event %s type=%s: %w", event.ID, event.Type, err)
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
		if err := store.SaveIndexerCursor(ctx, models.ProgramEventsCursorName, nextCursor); err != nil {
			return fmt.Errorf("save indexer cursor: %w", err)
		}
	} else if len(signatures) > 0 {
		log.Printf("program event backlog exceeded fetch limit; processed %d signature(s) without advancing cursor", len(signatures))
		if cursor.Signature != "" {
			if err := store.SaveIndexerCursor(ctx, models.ProgramEventsCursorName, cursor); err != nil {
				return fmt.Errorf("touch indexer cursor: %w", err)
			}
		}
	} else if cursor.Signature != "" {
		if err := store.SaveIndexerCursor(ctx, models.ProgramEventsCursorName, cursor); err != nil {
			return fmt.Errorf("touch indexer cursor: %w", err)
		}
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
	return nil
}
