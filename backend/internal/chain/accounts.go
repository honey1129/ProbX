package chain

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"

	"probx/backend/internal/models"
)

const lamportsPerSOL = 1_000_000_000

var marketDiscriminator = accountDiscriminator("Market")
var positionDiscriminator = accountDiscriminator("Position")
var marketCreatedEventDiscriminator = eventDiscriminator("MarketCreated")
var sharesBoughtEventDiscriminator = eventDiscriminator("SharesBought")
var sharesSoldEventDiscriminator = eventDiscriminator("SharesSold")
var marketResolvedEventDiscriminator = eventDiscriminator("MarketResolved")
var winningsRedeemedEventDiscriminator = eventDiscriminator("WinningsRedeemed")

type AccountClient struct {
	endpoint  string
	programID string
	client    *http.Client
}

type MarketAccount struct {
	PublicKey              string
	OnchainID              uint64
	Question               string
	Creator                string
	Resolver               string
	YesPoolLamports        uint64
	NoPoolLamports         uint64
	TotalLiquidityLamports uint64
	YesShares              uint64
	NoShares               uint64
	EndTime                int64
	Resolved               bool
	Outcome                uint8
}

type PositionAccount struct {
	PublicKey         string
	Owner             string
	MarketPublicKey   string
	YesAmountLamports uint64
	NoAmountLamports  uint64
}

type ProgramEvent struct {
	ID              string
	Signature       string
	Slot            uint64
	Type            string
	Action          string
	OnchainID       uint64
	MarketPublicKey string
	Owner           string
	Resolver        string
	Question        string
	EndTime         int64
	Side            uint8
	AmountLamports  uint64
	SharesLamports  uint64
	PayoutLamports  uint64
	Outcome         *int
	YesPoolLamports uint64
	NoPoolLamports  uint64
	TotalLiquidity  uint64
	PriceAfter      uint64
	BlockTime       int64
}

type EventFetchOptions struct {
	Limit          int
	PageSize       int
	UntilSignature string
}

func NewAccountClient(endpoint string, programID string, timeout time.Duration) (*AccountClient, error) {
	endpoint = strings.TrimSpace(endpoint)
	programID = strings.TrimSpace(programID)
	if endpoint == "" {
		return nil, fmt.Errorf("%w: Solana RPC URL is required", ErrVerifierUnavailable)
	}
	if programID == "" {
		return nil, fmt.Errorf("%w: program ID is required", ErrVerifierUnavailable)
	}
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return &AccountClient{
		endpoint:  endpoint,
		programID: programID,
		client:    &http.Client{Timeout: timeout},
	}, nil
}

func (c *AccountClient) FetchMarkets(ctx context.Context) ([]MarketAccount, error) {
	accounts, err := c.fetchProgramAccounts(ctx, marketDiscriminator)
	if err != nil {
		return nil, err
	}

	markets := make([]MarketAccount, 0, len(accounts))
	for _, account := range accounts {
		raw, err := account.Account.Data.Bytes()
		if err != nil {
			return nil, fmt.Errorf("%w: decode account %s data: %v", ErrVerifierUnavailable, account.Pubkey, err)
		}
		if !bytes.HasPrefix(raw, marketDiscriminator) {
			continue
		}
		market, err := DecodeMarketAccount(account.Pubkey, raw)
		if err != nil {
			return nil, fmt.Errorf("%w: decode market account %s: %v", ErrVerifierUnavailable, account.Pubkey, err)
		}
		markets = append(markets, market)
	}
	return markets, nil
}

func (c *AccountClient) FetchPositions(ctx context.Context) ([]PositionAccount, error) {
	accounts, err := c.fetchProgramAccounts(ctx, positionDiscriminator)
	if err != nil {
		return nil, err
	}

	positions := make([]PositionAccount, 0, len(accounts))
	for _, account := range accounts {
		raw, err := account.Account.Data.Bytes()
		if err != nil {
			return nil, fmt.Errorf("%w: decode account %s data: %v", ErrVerifierUnavailable, account.Pubkey, err)
		}
		if !bytes.HasPrefix(raw, positionDiscriminator) {
			continue
		}
		position, err := DecodePositionAccount(account.Pubkey, raw)
		if err != nil {
			return nil, fmt.Errorf("%w: decode position account %s: %v", ErrVerifierUnavailable, account.Pubkey, err)
		}
		positions = append(positions, position)
	}
	return positions, nil
}

func (c *AccountClient) FetchRecentEvents(ctx context.Context, limit int) ([]ProgramEvent, error) {
	events, _, err := c.FetchEvents(ctx, EventFetchOptions{Limit: limit})
	return events, err
}

func (c *AccountClient) FetchEvents(ctx context.Context, options EventFetchOptions) ([]ProgramEvent, []SignatureInfo, error) {
	if options.Limit <= 0 || options.Limit > 5000 {
		options.Limit = 500
	}
	if options.PageSize <= 0 || options.PageSize > 1000 {
		options.PageSize = 200
	}
	signatures, err := c.fetchSignaturesUntil(ctx, options.Limit, options.PageSize, strings.TrimSpace(options.UntilSignature))
	if err != nil {
		return nil, nil, err
	}

	events := []ProgramEvent{}
	ordered := append([]SignatureInfo{}, signatures...)
	reverseSignatures(ordered)
	for _, item := range ordered {
		logs, err := c.fetchTransactionLogs(ctx, item.Signature)
		if err != nil {
			return nil, nil, err
		}
		for index, logLine := range logs.LogMessages() {
			event, ok := DecodeProgramEvent(logLine)
			if !ok {
				continue
			}
			event.ID = fmt.Sprintf("%s_%d", item.Signature, index)
			event.Signature = item.Signature
			event.Slot = logs.Slot
			event.BlockTime = logs.BlockTime
			events = append(events, event)
		}
	}
	return events, signatures, nil
}

func (c *AccountClient) fetchSignatures(ctx context.Context, limit int) ([]SignatureInfo, error) {
	return c.fetchSignaturesPage(ctx, limit, "", "")
}

func (c *AccountClient) fetchSignaturesUntil(ctx context.Context, limit int, pageSize int, until string) ([]SignatureInfo, error) {
	signatures := []SignatureInfo{}
	before := ""
	for len(signatures) < limit {
		remaining := limit - len(signatures)
		nextLimit := pageSize
		if remaining < nextLimit {
			nextLimit = remaining
		}
		page, err := c.fetchSignaturesPage(ctx, nextLimit, before, until)
		if err != nil {
			return nil, err
		}
		if len(page) == 0 {
			break
		}
		signatures = append(signatures, page...)
		before = page[len(page)-1].Signature
		if len(page) < nextLimit {
			break
		}
	}
	return signatures, nil
}

func (c *AccountClient) fetchSignaturesPage(ctx context.Context, limit int, before string, until string) ([]SignatureInfo, error) {
	options := map[string]any{
		"limit":      limit,
		"commitment": "confirmed",
	}
	if strings.TrimSpace(before) != "" {
		options["before"] = strings.TrimSpace(before)
	}
	if strings.TrimSpace(until) != "" {
		options["until"] = strings.TrimSpace(until)
	}
	payload := rpcRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "getSignaturesForAddress",
		Params: []any{
			c.programID,
			options,
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("%w: marshal signature request: %v", ErrVerifierUnavailable, err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("%w: create signature request: %v", ErrVerifierUnavailable, err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	res, err := c.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%w: Solana signature request failed: %v", ErrVerifierUnavailable, err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("%w: Solana RPC returned HTTP %d", ErrVerifierUnavailable, res.StatusCode)
	}

	var rpc signatureResponse
	if err := json.NewDecoder(res.Body).Decode(&rpc); err != nil {
		return nil, fmt.Errorf("%w: decode signature response: %v", ErrVerifierUnavailable, err)
	}
	if rpc.Error != nil {
		return nil, fmt.Errorf("%w: Solana RPC error %d: %s", ErrVerifierUnavailable, rpc.Error.Code, rpc.Error.Message)
	}
	return rpc.Result, nil
}

func (c *AccountClient) fetchTransactionLogs(ctx context.Context, signature string) (transactionLogs, error) {
	payload := rpcRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "getTransaction",
		Params: []any{
			signature,
			map[string]any{
				"encoding":                       "json",
				"commitment":                     "confirmed",
				"maxSupportedTransactionVersion": 0,
			},
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return transactionLogs{}, fmt.Errorf("%w: marshal transaction request: %v", ErrVerifierUnavailable, err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return transactionLogs{}, fmt.Errorf("%w: create transaction request: %v", ErrVerifierUnavailable, err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	res, err := c.client.Do(httpReq)
	if err != nil {
		return transactionLogs{}, fmt.Errorf("%w: Solana transaction request failed: %v", ErrVerifierUnavailable, err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return transactionLogs{}, fmt.Errorf("%w: Solana RPC returned HTTP %d", ErrVerifierUnavailable, res.StatusCode)
	}

	var rpc transactionLogsResponse
	if err := json.NewDecoder(res.Body).Decode(&rpc); err != nil {
		return transactionLogs{}, fmt.Errorf("%w: decode transaction response: %v", ErrVerifierUnavailable, err)
	}
	if rpc.Error != nil {
		return transactionLogs{}, fmt.Errorf("%w: Solana RPC error %d: %s", ErrVerifierUnavailable, rpc.Error.Code, rpc.Error.Message)
	}
	if rpc.Result == nil {
		return transactionLogs{}, nil
	}
	return *rpc.Result, nil
}

func (c *AccountClient) fetchProgramAccounts(ctx context.Context, discriminator []byte) ([]programAccount, error) {
	payload := rpcRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "getProgramAccounts",
		Params: []any{
			c.programID,
			map[string]any{
				"encoding":   "base64",
				"commitment": "confirmed",
				"filters": []any{
					map[string]any{
						"memcmp": map[string]any{
							"offset": 0,
							"bytes":  base58Encode(discriminator),
						},
					},
				},
			},
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("%w: marshal RPC request: %v", ErrVerifierUnavailable, err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("%w: create RPC request: %v", ErrVerifierUnavailable, err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	res, err := c.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%w: Solana RPC request failed: %v", ErrVerifierUnavailable, err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("%w: Solana RPC returned HTTP %d", ErrVerifierUnavailable, res.StatusCode)
	}

	var rpc programAccountsResponse
	if err := json.NewDecoder(res.Body).Decode(&rpc); err != nil {
		return nil, fmt.Errorf("%w: decode RPC response: %v", ErrVerifierUnavailable, err)
	}
	if rpc.Error != nil {
		return nil, fmt.Errorf("%w: Solana RPC error %d: %s", ErrVerifierUnavailable, rpc.Error.Code, rpc.Error.Message)
	}
	return rpc.Result, nil
}

func DecodeMarketAccount(pubkey string, raw []byte) (MarketAccount, error) {
	reader := accountReader{raw: raw, offset: 0}
	discriminator := reader.readBytes(8)
	if reader.err != nil {
		return MarketAccount{}, reader.err
	}
	if !bytes.Equal(discriminator, marketDiscriminator) {
		return MarketAccount{}, fmt.Errorf("invalid Market discriminator")
	}

	market := MarketAccount{PublicKey: pubkey}
	market.OnchainID = reader.readU64()
	market.Question = reader.readString()
	market.Creator = base58Encode(reader.readBytes(32))
	market.Resolver = base58Encode(reader.readBytes(32))
	market.YesPoolLamports = reader.readU64()
	market.NoPoolLamports = reader.readU64()
	market.TotalLiquidityLamports = reader.readU64()
	market.YesShares = reader.readU64()
	market.NoShares = reader.readU64()
	market.EndTime = reader.readI64()
	market.Resolved = reader.readBool()
	market.Outcome = reader.readU8()
	if reader.err != nil {
		return MarketAccount{}, reader.err
	}
	return market, nil
}

func DecodePositionAccount(pubkey string, raw []byte) (PositionAccount, error) {
	reader := accountReader{raw: raw, offset: 0}
	discriminator := reader.readBytes(8)
	if reader.err != nil {
		return PositionAccount{}, reader.err
	}
	if !bytes.Equal(discriminator, positionDiscriminator) {
		return PositionAccount{}, fmt.Errorf("invalid Position discriminator")
	}

	position := PositionAccount{PublicKey: pubkey}
	position.Owner = base58Encode(reader.readBytes(32))
	position.MarketPublicKey = base58Encode(reader.readBytes(32))
	position.YesAmountLamports = reader.readU64()
	position.NoAmountLamports = reader.readU64()
	if reader.err != nil {
		return PositionAccount{}, reader.err
	}
	return position, nil
}

func DecodeProgramEvent(logLine string) (ProgramEvent, bool) {
	const prefix = "Program data: "
	if !strings.HasPrefix(logLine, prefix) {
		return ProgramEvent{}, false
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(strings.TrimPrefix(logLine, prefix)))
	if err != nil || len(raw) < 8 {
		return ProgramEvent{}, false
	}
	reader := accountReader{raw: raw, offset: 0}
	discriminator := reader.readBytes(8)
	switch {
	case bytes.Equal(discriminator, marketCreatedEventDiscriminator):
		event := ProgramEvent{Type: "MarketCreated", Action: "CREATE"}
		event.MarketPublicKey = base58Encode(reader.readBytes(32))
		event.OnchainID = reader.readU64()
		event.Owner = base58Encode(reader.readBytes(32))
		event.Resolver = base58Encode(reader.readBytes(32))
		event.Question = reader.readString()
		event.EndTime = reader.readI64()
		event.TotalLiquidity = reader.readU64()
		event.YesPoolLamports = reader.readU64()
		event.NoPoolLamports = reader.readU64()
		return event, reader.err == nil
	case bytes.Equal(discriminator, sharesBoughtEventDiscriminator):
		event := ProgramEvent{Type: "SharesBought", Action: "BUY"}
		event.MarketPublicKey = base58Encode(reader.readBytes(32))
		event.Owner = base58Encode(reader.readBytes(32))
		event.Side = reader.readU8()
		event.AmountLamports = reader.readU64()
		event.SharesLamports = reader.readU64()
		event.YesPoolLamports = reader.readU64()
		event.NoPoolLamports = reader.readU64()
		event.TotalLiquidity = reader.readU64()
		event.PriceAfter = reader.readU64()
		return event, reader.err == nil
	case bytes.Equal(discriminator, sharesSoldEventDiscriminator):
		event := ProgramEvent{Type: "SharesSold", Action: "SELL"}
		event.MarketPublicKey = base58Encode(reader.readBytes(32))
		event.Owner = base58Encode(reader.readBytes(32))
		event.Side = reader.readU8()
		event.SharesLamports = reader.readU64()
		event.AmountLamports = reader.readU64()
		event.YesPoolLamports = reader.readU64()
		event.NoPoolLamports = reader.readU64()
		event.TotalLiquidity = reader.readU64()
		event.PriceAfter = reader.readU64()
		return event, reader.err == nil
	case bytes.Equal(discriminator, marketResolvedEventDiscriminator):
		event := ProgramEvent{Type: "MarketResolved", Action: "RESOLVE"}
		event.MarketPublicKey = base58Encode(reader.readBytes(32))
		event.Owner = base58Encode(reader.readBytes(32))
		outcome := int(reader.readU8())
		event.Outcome = &outcome
		event.YesPoolLamports = reader.readU64()
		event.NoPoolLamports = reader.readU64()
		event.TotalLiquidity = reader.readU64()
		reader.readU64()
		reader.readU64()
		return event, reader.err == nil
	case bytes.Equal(discriminator, winningsRedeemedEventDiscriminator):
		event := ProgramEvent{Type: "WinningsRedeemed", Action: "REDEEM"}
		event.MarketPublicKey = base58Encode(reader.readBytes(32))
		event.Owner = base58Encode(reader.readBytes(32))
		outcome := int(reader.readU8())
		event.Outcome = &outcome
		event.PayoutLamports = reader.readU64()
		event.TotalLiquidity = reader.readU64()
		return event, reader.err == nil
	default:
		return ProgramEvent{}, false
	}
}

func (m MarketAccount) Model() models.Market {
	var outcome *int
	if m.Resolved {
		value := int(m.Outcome)
		outcome = &value
	}
	return models.Market{
		ID:             m.PublicKey,
		PublicKey:      m.PublicKey,
		Creator:        m.Creator,
		EndTime:        m.EndTime,
		Question:       m.Question,
		YesPool:        lamportsToSOL(m.YesPoolLamports),
		NoPool:         lamportsToSOL(m.NoPoolLamports),
		TotalLiquidity: lamportsToSOL(m.TotalLiquidityLamports),
		Resolved:       m.Resolved,
		Outcome:        outcome,
	}
}

func (p PositionAccount) Model() models.IndexedPosition {
	return models.IndexedPosition{
		PublicKey:       p.PublicKey,
		Owner:           p.Owner,
		MarketPublicKey: p.MarketPublicKey,
		YesAmount:       lamportsToSOL(p.YesAmountLamports),
		NoAmount:        lamportsToSOL(p.NoAmountLamports),
	}
}

func (e ProgramEvent) Model() models.IndexedEvent {
	var outcome *int
	if e.Outcome != nil {
		value := *e.Outcome
		outcome = &value
	}
	timestamp := time.Now().UnixMilli()
	if e.BlockTime > 0 {
		timestamp = e.BlockTime * 1000
	}
	return models.IndexedEvent{
		ID:              e.ID,
		Signature:       e.Signature,
		Slot:            e.Slot,
		Type:            e.Type,
		OnchainID:       e.OnchainID,
		MarketPublicKey: e.MarketPublicKey,
		Owner:           e.Owner,
		Resolver:        e.Resolver,
		Question:        e.Question,
		EndTime:         e.EndTime,
		Side:            sideLabel(e.Side),
		Action:          e.Action,
		AmountSOL:       lamportsToSOL(e.AmountLamports),
		Shares:          lamportsToSOL(e.SharesLamports),
		PayoutSOL:       lamportsToSOL(e.PayoutLamports),
		Outcome:         outcome,
		YesPool:         lamportsToSOL(e.YesPoolLamports),
		NoPool:          lamportsToSOL(e.NoPoolLamports),
		TotalLiquidity:  lamportsToSOL(e.TotalLiquidity),
		PriceAfter:      float64(e.PriceAfter) / lamportsPerSOL,
		TimestampMillis: timestamp,
	}
}

type programAccountsResponse struct {
	Result []programAccount `json:"result"`
	Error  *rpcError        `json:"error"`
}

type signatureResponse struct {
	Result []SignatureInfo `json:"result"`
	Error  *rpcError       `json:"error"`
}

type SignatureInfo struct {
	Signature string `json:"signature"`
	Slot      uint64 `json:"slot"`
	BlockTime int64  `json:"blockTime"`
}

type transactionLogsResponse struct {
	Result *transactionLogs `json:"result"`
	Error  *rpcError        `json:"error"`
}

type transactionLogs struct {
	Slot      uint64              `json:"slot"`
	BlockTime int64               `json:"blockTime"`
	Meta      transactionLogsMeta `json:"meta"`
}

func (t transactionLogs) LogMessages() []string {
	return t.Meta.LogMessages
}

type transactionLogsMeta struct {
	LogMessages []string `json:"logMessages"`
}

type programAccount struct {
	Pubkey  string             `json:"pubkey"`
	Account programAccountData `json:"account"`
}

type programAccountData struct {
	Data encodedAccountData `json:"data"`
}

type encodedAccountData struct {
	value    string
	encoding string
}

func (d *encodedAccountData) UnmarshalJSON(data []byte) error {
	var tuple []string
	if err := json.Unmarshal(data, &tuple); err == nil && len(tuple) > 0 {
		d.value = tuple[0]
		if len(tuple) > 1 {
			d.encoding = tuple[1]
		}
		return nil
	}
	var value string
	if err := json.Unmarshal(data, &value); err == nil {
		d.value = value
		return nil
	}
	return fmt.Errorf("unsupported account data shape")
}

func (d encodedAccountData) Bytes() ([]byte, error) {
	if d.encoding != "" && d.encoding != "base64" {
		return nil, fmt.Errorf("unsupported encoding %q", d.encoding)
	}
	return base64.StdEncoding.DecodeString(d.value)
}

type accountReader struct {
	raw    []byte
	offset int
	err    error
}

func (r *accountReader) readBytes(length int) []byte {
	if r.err != nil {
		return nil
	}
	if length < 0 || r.offset+length > len(r.raw) {
		r.err = fmt.Errorf("unexpected end of account data")
		return nil
	}
	value := r.raw[r.offset : r.offset+length]
	r.offset += length
	return value
}

func (r *accountReader) readU8() uint8 {
	data := r.readBytes(1)
	if r.err != nil {
		return 0
	}
	return data[0]
}

func (r *accountReader) readBool() bool {
	return r.readU8() != 0
}

func (r *accountReader) readU64() uint64 {
	data := r.readBytes(8)
	if r.err != nil {
		return 0
	}
	return binary.LittleEndian.Uint64(data)
}

func (r *accountReader) readI64() int64 {
	return int64(r.readU64())
}

func (r *accountReader) readString() string {
	lengthBytes := r.readBytes(4)
	if r.err != nil {
		return ""
	}
	length := int(binary.LittleEndian.Uint32(lengthBytes))
	data := r.readBytes(length)
	if r.err != nil {
		return ""
	}
	return string(data)
}

func accountDiscriminator(name string) []byte {
	hash := sha256.Sum256([]byte("account:" + name))
	return hash[:8]
}

func eventDiscriminator(name string) []byte {
	hash := sha256.Sum256([]byte("event:" + name))
	return hash[:8]
}

func sideLabel(side uint8) string {
	if side == 1 {
		return "YES"
	}
	return "NO"
}

func lamportsToSOL(value uint64) float64 {
	return float64(value) / lamportsPerSOL
}

func reverseSignatures(values []SignatureInfo) {
	for i, j := 0, len(values)-1; i < j; i, j = i+1, j-1 {
		values[i], values[j] = values[j], values[i]
	}
}

func base58Encode(input []byte) string {
	const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
	x := new(big.Int).SetBytes(input)
	base := big.NewInt(58)
	zero := big.NewInt(0)
	mod := new(big.Int)
	out := []byte{}

	for x.Cmp(zero) > 0 {
		x.DivMod(x, base, mod)
		out = append(out, alphabet[mod.Int64()])
	}
	for _, b := range input {
		if b == 0 {
			out = append(out, alphabet[0])
			continue
		}
		break
	}
	if len(out) == 0 {
		return string(alphabet[0])
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return string(out)
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
