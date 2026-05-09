package chain

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"probx/backend/internal/models"
)

func TestVerifierAcceptsConfirmedProgramTransaction(t *testing.T) {
	verifier := testVerifier(t, map[string]any{
		"result": successfulTransaction("sig_123", "owner_123", "program_123", "market_123", "buy_shares", 1_500_000_000, 1),
	})

	err := verifier.VerifyTrade(context.Background(), models.TradeRequest{
		Signature:       "sig_123",
		Owner:           "owner_123",
		MarketPublicKey: "market_123",
		Side:            "YES",
		AmountSOL:       1.5,
		Action:          "BUY",
	})
	if err != nil {
		t.Fatalf("expected verification success, got %v", err)
	}
}

func TestVerifierAcceptsConfirmedCreateMarketTransaction(t *testing.T) {
	verifier := testVerifier(t, map[string]any{
		"result": successfulCreateMarketTransaction("sig_123", "creator_123", "program_123", "market_123", "Will SOL close above $250?", 1_893_456_000, 2_000_000_000),
	})

	err := verifier.VerifyCreateMarket(context.Background(), models.CreateMarketRequest{
		Signature:        "sig_123",
		Creator:          "creator_123",
		PublicKey:        "market_123",
		Question:         "Will SOL close above $250?",
		EndTime:          1_893_456_000,
		InitialLiquidity: 2,
	})
	if err != nil {
		t.Fatalf("expected verification success, got %v", err)
	}
}

func TestVerifierRejectsMismatchedCreateMarketInstruction(t *testing.T) {
	verifier := testVerifier(t, map[string]any{
		"result": successfulCreateMarketTransaction("sig_123", "creator_123", "program_123", "market_123", "Will SOL close above $250?", 1_893_456_000, 2_000_000_000),
	})

	err := verifier.VerifyCreateMarket(context.Background(), models.CreateMarketRequest{
		Signature:        "sig_123",
		Creator:          "creator_123",
		PublicKey:        "market_123",
		Question:         "Will ETH close above $5,000?",
		EndTime:          1_893_456_000,
		InitialLiquidity: 2,
	})
	if !errors.Is(err, ErrVerificationFailed) {
		t.Fatalf("expected verification failure, got %v", err)
	}
}

func TestVerifierRejectsMissingOwnerSigner(t *testing.T) {
	verifier := testVerifier(t, map[string]any{
		"result": successfulTransaction("sig_123", "someone_else", "program_123", "market_123", "buy_shares", 1_500_000_000, 1),
	})

	err := verifier.VerifyTrade(context.Background(), models.TradeRequest{
		Signature:       "sig_123",
		Owner:           "owner_123",
		MarketPublicKey: "market_123",
		Side:            "YES",
		AmountSOL:       1.5,
		Action:          "BUY",
	})
	if !errors.Is(err, ErrVerificationFailed) {
		t.Fatalf("expected verification failure, got %v", err)
	}
}

func TestVerifierRejectsMismatchedTradeInstruction(t *testing.T) {
	verifier := testVerifier(t, map[string]any{
		"result": successfulTransaction("sig_123", "owner_123", "program_123", "market_123", "buy_shares", 1_500_000_000, 1),
	})

	err := verifier.VerifyTrade(context.Background(), models.TradeRequest{
		Signature:       "sig_123",
		Owner:           "owner_123",
		MarketPublicKey: "market_123",
		Side:            "NO",
		AmountSOL:       1.5,
		Action:          "BUY",
	})
	if !errors.Is(err, ErrVerificationFailed) {
		t.Fatalf("expected verification failure, got %v", err)
	}
}

func TestVerifierAcceptsConfirmedSellTransaction(t *testing.T) {
	verifier := testVerifier(t, map[string]any{
		"result": successfulTransaction("sig_123", "owner_123", "program_123", "market_123", "sell_shares", 750_000_000, 0),
	})

	err := verifier.VerifyTrade(context.Background(), models.TradeRequest{
		Signature:       "sig_123",
		Owner:           "owner_123",
		MarketPublicKey: "market_123",
		Side:            "NO",
		AmountSOL:       0.75,
		Action:          "SELL",
	})
	if err != nil {
		t.Fatalf("expected verification success, got %v", err)
	}
}

func TestVerifierAcceptsConfirmedResolveTransaction(t *testing.T) {
	verifier := testVerifier(t, map[string]any{
		"result": successfulResolveTransaction("sig_123", "resolver_123", "program_123", "market_123", 1),
	})

	err := verifier.VerifyResolve(context.Background(), models.ResolveMarketRequest{
		Signature:       "sig_123",
		Resolver:        "resolver_123",
		MarketPublicKey: "market_123",
		Outcome:         1,
	})
	if err != nil {
		t.Fatalf("expected verification success, got %v", err)
	}
}

func TestVerifierRejectsMismatchedResolveInstruction(t *testing.T) {
	verifier := testVerifier(t, map[string]any{
		"result": successfulResolveTransaction("sig_123", "resolver_123", "program_123", "market_123", 1),
	})

	err := verifier.VerifyResolve(context.Background(), models.ResolveMarketRequest{
		Signature:       "sig_123",
		Resolver:        "resolver_123",
		MarketPublicKey: "market_123",
		Outcome:         0,
	})
	if !errors.Is(err, ErrVerificationFailed) {
		t.Fatalf("expected verification failure, got %v", err)
	}
}

func TestVerifierAcceptsConfirmedRedeemTransaction(t *testing.T) {
	verifier := testVerifier(t, map[string]any{
		"result": successfulRedeemTransaction("sig_123", "owner_123", "program_123", "market_123"),
	})

	err := verifier.VerifyRedeem(context.Background(), models.RedeemPositionRequest{
		Signature:       "sig_123",
		Owner:           "owner_123",
		MarketPublicKey: "market_123",
	})
	if err != nil {
		t.Fatalf("expected verification success, got %v", err)
	}
}

func TestVerifierRejectsMismatchedRedeemInstruction(t *testing.T) {
	verifier := testVerifier(t, map[string]any{
		"result": successfulRedeemTransaction("sig_123", "owner_123", "program_123", "market_123"),
	})

	err := verifier.VerifyRedeem(context.Background(), models.RedeemPositionRequest{
		Signature:       "sig_123",
		Owner:           "owner_123",
		MarketPublicKey: "different_market",
	})
	if !errors.Is(err, ErrVerificationFailed) {
		t.Fatalf("expected verification failure, got %v", err)
	}
}

func TestVerifierRejectsRPCErrorAsUnavailable(t *testing.T) {
	verifier := testVerifier(t, map[string]any{
		"error": map[string]any{
			"code":    -32005,
			"message": "node is unhealthy",
		},
	})

	err := verifier.VerifyTrade(context.Background(), models.TradeRequest{
		Signature:       "sig_123",
		Owner:           "owner_123",
		MarketPublicKey: "market_123",
		Side:            "YES",
		AmountSOL:       1.5,
		Action:          "BUY",
	})
	if !errors.Is(err, ErrVerifierUnavailable) {
		t.Fatalf("expected verifier unavailable, got %v", err)
	}
}

func testVerifier(t *testing.T, response map[string]any) *Verifier {
	t.Helper()
	return &Verifier{
		endpoint:  "http://solana.invalid",
		programID: "program_123",
		client: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			if r.Method != http.MethodPost {
				t.Fatalf("expected POST, got %s", r.Method)
			}
			var payload rpcRequest
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if payload.Method != "getTransaction" {
				t.Fatalf("expected getTransaction, got %s", payload.Method)
			}

			out := map[string]any{
				"jsonrpc": "2.0",
				"id":      payload.ID,
			}
			for key, value := range response {
				out[key] = value
			}
			body, err := json.Marshal(out)
			if err != nil {
				t.Fatalf("encode response: %v", err)
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(string(body))),
			}, nil
		})},
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func successfulTransaction(signature string, owner string, programID string, market string, instructionName string, amount uint64, side uint8) map[string]any {
	return map[string]any{
		"meta": map[string]any{
			"err": nil,
			"loadedAddresses": map[string]any{
				"writable": []string{},
				"readonly": []string{},
			},
			"innerInstructions": []any{},
		},
		"transaction": map[string]any{
			"signatures": []string{signature},
			"message": map[string]any{
				"accountKeys": []map[string]any{
					{"pubkey": owner, "signer": true},
					{"pubkey": programID, "signer": false},
				},
				"instructions": []map[string]any{
					{
						"programId": programID,
						"accounts":  []string{market, "position_123", owner},
						"data":      base58Encode(tradeInstructionBytes(instructionName, amount, side)),
					},
				},
			},
		},
	}
}

func successfulCreateMarketTransaction(signature string, creator string, programID string, market string, question string, endTime int64, initialLiquidity uint64) map[string]any {
	return map[string]any{
		"meta": map[string]any{
			"err": nil,
			"loadedAddresses": map[string]any{
				"writable": []string{},
				"readonly": []string{},
			},
			"innerInstructions": []any{},
		},
		"transaction": map[string]any{
			"signatures": []string{signature},
			"message": map[string]any{
				"accountKeys": []map[string]any{
					{"pubkey": creator, "signer": true},
					{"pubkey": programID, "signer": false},
				},
				"instructions": []map[string]any{
					{
						"programId": programID,
						"accounts":  []string{market, creator, "11111111111111111111111111111111"},
						"data":      base58Encode(createMarketInstructionBytes(question, endTime, initialLiquidity)),
					},
				},
			},
		},
	}
}

func successfulResolveTransaction(signature string, resolver string, programID string, market string, outcome uint8) map[string]any {
	return map[string]any{
		"meta": map[string]any{
			"err": nil,
			"loadedAddresses": map[string]any{
				"writable": []string{},
				"readonly": []string{},
			},
			"innerInstructions": []any{},
		},
		"transaction": map[string]any{
			"signatures": []string{signature},
			"message": map[string]any{
				"accountKeys": []map[string]any{
					{"pubkey": resolver, "signer": true},
					{"pubkey": programID, "signer": false},
				},
				"instructions": []map[string]any{
					{
						"programId": programID,
						"accounts":  []string{market, resolver},
						"data":      base58Encode(resolveInstructionBytes(outcome)),
					},
				},
			},
		},
	}
}

func successfulRedeemTransaction(signature string, owner string, programID string, market string) map[string]any {
	return map[string]any{
		"meta": map[string]any{
			"err": nil,
			"loadedAddresses": map[string]any{
				"writable": []string{},
				"readonly": []string{},
			},
			"innerInstructions": []any{},
		},
		"transaction": map[string]any{
			"signatures": []string{signature},
			"message": map[string]any{
				"accountKeys": []map[string]any{
					{"pubkey": owner, "signer": true},
					{"pubkey": programID, "signer": false},
				},
				"instructions": []map[string]any{
					{
						"programId": programID,
						"accounts":  []string{market, "position_123", owner},
						"data":      base58Encode(redeemInstructionBytes("redeem_winnings")),
					},
				},
			},
		},
	}
}

func createMarketInstructionBytes(question string, endTime int64, initialLiquidity uint64) []byte {
	out := append([]byte{}, createMarketInstruction...)
	questionLength := make([]byte, 4)
	binary.LittleEndian.PutUint32(questionLength, uint32(len(question)))
	out = append(out, questionLength...)
	out = append(out, []byte(question)...)
	endTimeBytes := make([]byte, 8)
	binary.LittleEndian.PutUint64(endTimeBytes, uint64(endTime))
	out = append(out, endTimeBytes...)
	liquidityBytes := make([]byte, 8)
	binary.LittleEndian.PutUint64(liquidityBytes, initialLiquidity)
	out = append(out, liquidityBytes...)
	return out
}

func tradeInstructionBytes(name string, amount uint64, side uint8) []byte {
	var discriminator []byte
	switch name {
	case "sell_shares":
		discriminator = sellSharesInstruction
	case "place_bet":
		discriminator = placeBetInstruction
	default:
		discriminator = buySharesInstruction
	}
	out := append([]byte{}, discriminator...)
	amountBytes := make([]byte, 8)
	binary.LittleEndian.PutUint64(amountBytes, amount)
	out = append(out, amountBytes...)
	out = append(out, side)
	out = append(out, make([]byte, 8)...)
	return out
}

func resolveInstructionBytes(outcome uint8) []byte {
	out := append([]byte{}, resolveMarketInstruction...)
	out = append(out, outcome)
	return out
}

func redeemInstructionBytes(name string) []byte {
	if name == "claim_reward" {
		return append([]byte{}, claimRewardInstruction...)
	}
	return append([]byte{}, redeemWinningsInstruction...)
}
