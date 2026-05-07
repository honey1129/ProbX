package chain

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"testing"
)

func TestDecodeMarketAccount(t *testing.T) {
	creator := bytes.Repeat([]byte{1}, 32)
	resolver := bytes.Repeat([]byte{2}, 32)
	raw := marketAccountBytes(t, marketAccountFixture{
		OnchainID:              42,
		Question:               "Will SOL close above $250?",
		Creator:                creator,
		Resolver:               resolver,
		YesPoolLamports:        3_000_000_000,
		NoPoolLamports:         1_000_000_000,
		TotalLiquidityLamports: 4_000_000_000,
		YesShares:              700_000_000,
		NoShares:               100_000_000,
		EndTime:                1_893_456_000,
		Resolved:               true,
		Outcome:                1,
	})

	account, err := DecodeMarketAccount("market_pubkey", raw)
	if err != nil {
		t.Fatalf("decode market: %v", err)
	}
	if account.OnchainID != 42 || account.Question != "Will SOL close above $250?" {
		t.Fatalf("unexpected decoded account: %+v", account)
	}
	if account.Creator != base58Encode(creator) || account.Resolver != base58Encode(resolver) {
		t.Fatalf("unexpected pubkeys creator=%s resolver=%s", account.Creator, account.Resolver)
	}
	if account.YesPoolLamports != 3_000_000_000 || account.NoPoolLamports != 1_000_000_000 {
		t.Fatalf("unexpected pools: %+v", account)
	}

	model := account.Model()
	if model.ID != "market_pubkey" || model.PublicKey != "market_pubkey" {
		t.Fatalf("unexpected model ids: %+v", model)
	}
	if model.YesPool != 3 || model.NoPool != 1 || model.TotalLiquidity != 4 {
		t.Fatalf("expected SOL-denominated model pools, got %+v", model)
	}
	if model.Outcome == nil || *model.Outcome != 1 {
		t.Fatalf("expected resolved outcome, got %+v", model.Outcome)
	}
}

func TestAccountClientFetchMarkets(t *testing.T) {
	marketRaw := marketAccountBytes(t, marketAccountFixture{
		OnchainID:              7,
		Question:               "Will indexer decode this market?",
		Creator:                bytes.Repeat([]byte{3}, 32),
		Resolver:               bytes.Repeat([]byte{4}, 32),
		YesPoolLamports:        2_000_000_000,
		NoPoolLamports:         2_000_000_000,
		TotalLiquidityLamports: 2_000_000_000,
		EndTime:                1_893_456_000,
	})
	otherRaw := []byte("not a market account")
	client := &AccountClient{
		endpoint:  "http://solana.invalid",
		programID: "program_123",
		client: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			var payload rpcRequest
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if payload.Method != "getProgramAccounts" {
				t.Fatalf("expected getProgramAccounts, got %s", payload.Method)
			}
			assertMarketDiscriminatorFilter(t, payload)
			return jsonResponse(t, map[string]any{
				"jsonrpc": "2.0",
				"id":      payload.ID,
				"result": []map[string]any{
					{
						"pubkey": "market_1",
						"account": map[string]any{
							"data": []string{base64.StdEncoding.EncodeToString(marketRaw), "base64"},
						},
					},
					{
						"pubkey": "other_1",
						"account": map[string]any{
							"data": []string{base64.StdEncoding.EncodeToString(otherRaw), "base64"},
						},
					},
				},
			}), nil
		})},
	}

	markets, err := client.FetchMarkets(context.Background())
	if err != nil {
		t.Fatalf("fetch markets: %v", err)
	}
	if len(markets) != 1 {
		t.Fatalf("expected 1 market, got %d", len(markets))
	}
	if markets[0].PublicKey != "market_1" || markets[0].OnchainID != 7 {
		t.Fatalf("unexpected market: %+v", markets[0])
	}
}

func assertMarketDiscriminatorFilter(t *testing.T, payload rpcRequest) {
	t.Helper()
	if len(payload.Params) != 2 {
		t.Fatalf("expected 2 params, got %+v", payload.Params)
	}
	options, ok := payload.Params[1].(map[string]any)
	if !ok {
		t.Fatalf("expected options map, got %+v", payload.Params[1])
	}
	filters, ok := options["filters"].([]any)
	if !ok || len(filters) != 1 {
		t.Fatalf("expected one filter, got %+v", options["filters"])
	}
	filter, ok := filters[0].(map[string]any)
	if !ok {
		t.Fatalf("expected filter map, got %+v", filters[0])
	}
	memcmp, ok := filter["memcmp"].(map[string]any)
	if !ok {
		t.Fatalf("expected memcmp filter, got %+v", filter["memcmp"])
	}
	if memcmp["offset"] != float64(0) || memcmp["bytes"] != base58Encode(marketDiscriminator) {
		t.Fatalf("unexpected discriminator filter: %+v", memcmp)
	}
}

type marketAccountFixture struct {
	OnchainID              uint64
	Question               string
	Creator                []byte
	Resolver               []byte
	YesPoolLamports        uint64
	NoPoolLamports         uint64
	TotalLiquidityLamports uint64
	YesShares              uint64
	NoShares               uint64
	EndTime                int64
	Resolved               bool
	Outcome                uint8
}

func marketAccountBytes(t *testing.T, fixture marketAccountFixture) []byte {
	t.Helper()
	buf := bytes.NewBuffer(nil)
	buf.Write(marketDiscriminator)
	writeU64(t, buf, fixture.OnchainID)
	writeString(t, buf, fixture.Question)
	buf.Write(fixture.Creator)
	buf.Write(fixture.Resolver)
	writeU64(t, buf, fixture.YesPoolLamports)
	writeU64(t, buf, fixture.NoPoolLamports)
	writeU64(t, buf, fixture.TotalLiquidityLamports)
	writeU64(t, buf, fixture.YesShares)
	writeU64(t, buf, fixture.NoShares)
	writeU64(t, buf, uint64(fixture.EndTime))
	if fixture.Resolved {
		buf.WriteByte(1)
	} else {
		buf.WriteByte(0)
	}
	buf.WriteByte(fixture.Outcome)
	return buf.Bytes()
}

func writeString(t *testing.T, buf *bytes.Buffer, value string) {
	t.Helper()
	if err := binary.Write(buf, binary.LittleEndian, uint32(len(value))); err != nil {
		t.Fatalf("write string length: %v", err)
	}
	buf.WriteString(value)
}

func writeU64(t *testing.T, buf *bytes.Buffer, value uint64) {
	t.Helper()
	if err := binary.Write(buf, binary.LittleEndian, value); err != nil {
		t.Fatalf("write u64: %v", err)
	}
}

func jsonResponse(t *testing.T, payload map[string]any) *http.Response {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       ioNopCloser{Reader: bytes.NewReader(body)},
	}
}

type ioNopCloser struct {
	*bytes.Reader
}

func (ioNopCloser) Close() error {
	return nil
}
