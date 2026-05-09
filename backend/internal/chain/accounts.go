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

type programAccountsResponse struct {
	Result []programAccount `json:"result"`
	Error  *rpcError        `json:"error"`
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

func lamportsToSOL(value uint64) float64 {
	return float64(value) / lamportsPerSOL
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
