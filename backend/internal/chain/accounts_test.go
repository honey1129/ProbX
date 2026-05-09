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

func TestDecodePositionAccount(t *testing.T) {
	owner := bytes.Repeat([]byte{5}, 32)
	market := bytes.Repeat([]byte{6}, 32)
	raw := positionAccountBytes(t, positionAccountFixture{
		Owner:             owner,
		Market:            market,
		YesAmountLamports: 1_250_000_000,
		NoAmountLamports:  500_000_000,
	})

	account, err := DecodePositionAccount("position_pubkey", raw)
	if err != nil {
		t.Fatalf("decode position: %v", err)
	}
	if account.PublicKey != "position_pubkey" || account.Owner != base58Encode(owner) || account.MarketPublicKey != base58Encode(market) {
		t.Fatalf("unexpected decoded position: %+v", account)
	}

	model := account.Model()
	if model.YesAmount != 1.25 || model.NoAmount != 0.5 {
		t.Fatalf("expected SOL-denominated model amounts, got %+v", model)
	}
}

func TestDecodeMarketCreatedEvent(t *testing.T) {
	market := bytes.Repeat([]byte{9}, 32)
	creator := bytes.Repeat([]byte{10}, 32)
	resolver := bytes.Repeat([]byte{11}, 32)
	raw := append([]byte{}, marketCreatedEventDiscriminator...)
	raw = append(raw, market...)
	raw = appendU64(raw, 77)
	raw = append(raw, creator...)
	raw = append(raw, resolver...)
	raw = appendString(raw, "Will SOL close above $250?")
	raw = appendU64(raw, 1_893_456_000)
	raw = appendU64(raw, 2_000_000_000)
	raw = appendU64(raw, 2_000_000_000)
	raw = appendU64(raw, 2_000_000_000)

	event, ok := DecodeProgramEvent("Program data: " + base64.StdEncoding.EncodeToString(raw))
	if !ok {
		t.Fatalf("expected event decode")
	}
	if event.Type != "MarketCreated" || event.Action != "CREATE" || event.OnchainID != 77 {
		t.Fatalf("unexpected event header: %+v", event)
	}
	if event.MarketPublicKey != base58Encode(market) || event.Owner != base58Encode(creator) || event.Resolver != base58Encode(resolver) {
		t.Fatalf("unexpected event pubkeys: %+v", event)
	}
	if event.Question != "Will SOL close above $250?" || event.EndTime != 1_893_456_000 {
		t.Fatalf("unexpected event content: %+v", event)
	}
	model := event.Model()
	if model.OnchainID != 77 || model.Question != event.Question || model.TotalLiquidity != 2 {
		t.Fatalf("unexpected model: %+v", model)
	}
}

func TestDecodeSharesBoughtEvent(t *testing.T) {
	market := bytes.Repeat([]byte{11}, 32)
	owner := bytes.Repeat([]byte{12}, 32)
	raw := append([]byte{}, sharesBoughtEventDiscriminator...)
	raw = append(raw, market...)
	raw = append(raw, owner...)
	raw = append(raw, 1)
	raw = appendU64(raw, 1_500_000_000)
	raw = appendU64(raw, 600_000_000)
	raw = appendU64(raw, 3_500_000_000)
	raw = appendU64(raw, 2_000_000_000)
	raw = appendU64(raw, 4_500_000_000)
	raw = appendU64(raw, 636_363_636)

	event, ok := DecodeProgramEvent("Program data: " + base64.StdEncoding.EncodeToString(raw))
	if !ok {
		t.Fatalf("expected event decode")
	}
	if event.Type != "SharesBought" || event.Action != "BUY" || event.Side != 1 {
		t.Fatalf("unexpected event header: %+v", event)
	}
	if event.MarketPublicKey != base58Encode(market) || event.Owner != base58Encode(owner) {
		t.Fatalf("unexpected event pubkeys: %+v", event)
	}
	model := event.Model()
	if model.AmountSOL != 1.5 || model.Shares != 0.6 || model.Side != "YES" {
		t.Fatalf("unexpected model: %+v", model)
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
			assertDiscriminatorFilter(t, payload, marketDiscriminator)
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

func TestAccountClientFetchRecentEvents(t *testing.T) {
	raw := append([]byte{}, sharesSoldEventDiscriminator...)
	raw = append(raw, bytes.Repeat([]byte{13}, 32)...)
	raw = append(raw, bytes.Repeat([]byte{14}, 32)...)
	raw = append(raw, 0)
	raw = appendU64(raw, 500_000_000)
	raw = appendU64(raw, 250_000_000)
	raw = appendU64(raw, 2_000_000_000)
	raw = appendU64(raw, 3_000_000_000)
	raw = appendU64(raw, 4_000_000_000)
	raw = appendU64(raw, 400_000_000)

	call := 0
	client := &AccountClient{
		endpoint:  "http://solana.invalid",
		programID: "program_123",
		client: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			call++
			var payload rpcRequest
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if call == 1 {
				if payload.Method != "getSignaturesForAddress" {
					t.Fatalf("expected getSignaturesForAddress, got %s", payload.Method)
				}
				return jsonResponse(t, map[string]any{
					"jsonrpc": "2.0",
					"id":      payload.ID,
					"result": []map[string]any{
						{"signature": "sig_1", "slot": 99, "blockTime": 1234},
					},
				}), nil
			}
			if payload.Method != "getTransaction" {
				t.Fatalf("expected getTransaction, got %s", payload.Method)
			}
			return jsonResponse(t, map[string]any{
				"jsonrpc": "2.0",
				"id":      payload.ID,
				"result": map[string]any{
					"slot":      99,
					"blockTime": 1234,
					"meta": map[string]any{
						"logMessages": []string{
							"Program log: Instruction: SellShares",
							"Program data: " + base64.StdEncoding.EncodeToString(raw),
						},
					},
				},
			}), nil
		})},
	}

	events, err := client.FetchRecentEvents(context.Background(), 10)
	if err != nil {
		t.Fatalf("fetch events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].ID != "sig_1_1" || events[0].Signature != "sig_1" || events[0].Type != "SharesSold" {
		t.Fatalf("unexpected event: %+v", events[0])
	}
}

func TestAccountClientFetchEventsPaginatesUntilCursorAndReturnsOldestFirst(t *testing.T) {
	raw := append([]byte{}, sharesBoughtEventDiscriminator...)
	raw = append(raw, bytes.Repeat([]byte{15}, 32)...)
	raw = append(raw, bytes.Repeat([]byte{16}, 32)...)
	raw = append(raw, 1)
	raw = appendU64(raw, 1_000_000_000)
	raw = appendU64(raw, 500_000_000)
	raw = appendU64(raw, 2_500_000_000)
	raw = appendU64(raw, 1_500_000_000)
	raw = appendU64(raw, 4_000_000_000)
	raw = appendU64(raw, 625_000_000)

	signaturePages := [][]map[string]any{
		{
			{"signature": "sig_new", "slot": 102, "blockTime": 1002},
			{"signature": "sig_mid", "slot": 101, "blockTime": 1001},
		},
		{
			{"signature": "sig_old", "slot": 100, "blockTime": 1000},
		},
	}
	signatureCalls := 0
	transactionCalls := 0
	client := &AccountClient{
		endpoint:  "http://solana.invalid",
		programID: "program_123",
		client: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			var payload rpcRequest
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			switch payload.Method {
			case "getSignaturesForAddress":
				if signatureCalls >= len(signaturePages) {
					t.Fatalf("unexpected signature page request %d", signatureCalls+1)
				}
				options, ok := payload.Params[1].(map[string]any)
				if !ok {
					t.Fatalf("expected signature options map, got %+v", payload.Params[1])
				}
				if options["until"] != "sig_cursor" {
					t.Fatalf("expected until cursor on page %d, got %+v", signatureCalls+1, options)
				}
				if signatureCalls == 0 {
					if _, ok := options["before"]; ok {
						t.Fatalf("did not expect before on first page: %+v", options)
					}
				} else if options["before"] != "sig_mid" {
					t.Fatalf("expected before sig_mid on second page, got %+v", options)
				}
				page := signaturePages[signatureCalls]
				signatureCalls++
				return jsonResponse(t, map[string]any{
					"jsonrpc": "2.0",
					"id":      payload.ID,
					"result":  page,
				}), nil
			case "getTransaction":
				if len(payload.Params) == 0 {
					t.Fatalf("expected transaction signature param")
				}
				signature, ok := payload.Params[0].(string)
				if !ok {
					t.Fatalf("expected transaction signature string, got %+v", payload.Params[0])
				}
				expectedOrder := []string{"sig_old", "sig_mid", "sig_new"}
				if transactionCalls >= len(expectedOrder) || signature != expectedOrder[transactionCalls] {
					t.Fatalf("unexpected transaction order call=%d signature=%s", transactionCalls+1, signature)
				}
				transactionCalls++
				return jsonResponse(t, map[string]any{
					"jsonrpc": "2.0",
					"id":      payload.ID,
					"result": map[string]any{
						"slot":      200 + transactionCalls,
						"blockTime": 3000 + transactionCalls,
						"meta": map[string]any{
							"logMessages": []string{
								"Program data: " + base64.StdEncoding.EncodeToString(raw),
							},
						},
					},
				}), nil
			default:
				t.Fatalf("unexpected method %s", payload.Method)
				return nil, nil
			}
		})},
	}

	events, signatures, err := client.FetchEvents(context.Background(), EventFetchOptions{
		Limit:          3,
		PageSize:       2,
		UntilSignature: "sig_cursor",
	})
	if err != nil {
		t.Fatalf("fetch paginated events: %v", err)
	}
	if signatureCalls != 2 {
		t.Fatalf("expected 2 signature calls, got %d", signatureCalls)
	}
	if len(signatures) != 3 || signatures[0].Signature != "sig_new" || signatures[2].Signature != "sig_old" {
		t.Fatalf("expected newest-first signatures, got %+v", signatures)
	}
	if len(events) != 3 {
		t.Fatalf("expected 3 events, got %d", len(events))
	}
	if events[0].Signature != "sig_old" || events[1].Signature != "sig_mid" || events[2].Signature != "sig_new" {
		t.Fatalf("expected oldest-first events, got %+v", events)
	}
}

func TestAccountClientFetchPositions(t *testing.T) {
	positionRaw := positionAccountBytes(t, positionAccountFixture{
		Owner:             bytes.Repeat([]byte{7}, 32),
		Market:            bytes.Repeat([]byte{8}, 32),
		YesAmountLamports: 2_000_000_000,
		NoAmountLamports:  1_000_000_000,
	})
	otherRaw := []byte("not a position account")
	client := &AccountClient{
		endpoint:  "http://solana.invalid",
		programID: "program_123",
		client: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			var payload rpcRequest
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			assertDiscriminatorFilter(t, payload, positionDiscriminator)
			return jsonResponse(t, map[string]any{
				"jsonrpc": "2.0",
				"id":      payload.ID,
				"result": []map[string]any{
					{
						"pubkey": "position_1",
						"account": map[string]any{
							"data": []string{base64.StdEncoding.EncodeToString(positionRaw), "base64"},
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

	positions, err := client.FetchPositions(context.Background())
	if err != nil {
		t.Fatalf("fetch positions: %v", err)
	}
	if len(positions) != 1 {
		t.Fatalf("expected 1 position, got %d", len(positions))
	}
	if positions[0].PublicKey != "position_1" || positions[0].YesAmountLamports != 2_000_000_000 {
		t.Fatalf("unexpected position: %+v", positions[0])
	}
}

func assertDiscriminatorFilter(t *testing.T, payload rpcRequest, discriminator []byte) {
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
	if memcmp["offset"] != float64(0) || memcmp["bytes"] != base58Encode(discriminator) {
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

type positionAccountFixture struct {
	Owner             []byte
	Market            []byte
	YesAmountLamports uint64
	NoAmountLamports  uint64
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

func positionAccountBytes(t *testing.T, fixture positionAccountFixture) []byte {
	t.Helper()
	buf := bytes.NewBuffer(nil)
	buf.Write(positionDiscriminator)
	buf.Write(fixture.Owner)
	buf.Write(fixture.Market)
	writeU64(t, buf, fixture.YesAmountLamports)
	writeU64(t, buf, fixture.NoAmountLamports)
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

func appendU64(out []byte, value uint64) []byte {
	buf := make([]byte, 8)
	binary.LittleEndian.PutUint64(buf, value)
	return append(out, buf...)
}

func appendString(out []byte, value string) []byte {
	buf := make([]byte, 4)
	binary.LittleEndian.PutUint32(buf, uint32(len(value)))
	out = append(out, buf...)
	return append(out, []byte(value)...)
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
