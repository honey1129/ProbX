package chain

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"probx/backend/internal/models"
)

var (
	ErrVerificationFailed  = errors.New("transaction verification failed")
	ErrVerifierUnavailable = errors.New("transaction verifier unavailable")
)

var (
	buySharesInstruction        = instructionDiscriminator("buy_shares")
	createMarketInstruction     = instructionDiscriminator("create_market")
	sellSharesInstruction       = instructionDiscriminator("sell_shares")
	placeBetInstruction         = instructionDiscriminator("place_bet")
	resolveMarketInstruction    = instructionDiscriminator("resolve_market")
	setResolverInstruction      = instructionDiscriminator("set_resolver")
	cancelMarketInstruction     = instructionDiscriminator("cancel_market")
	redeemWinningsInstruction   = instructionDiscriminator("redeem_winnings")
	refundCancelledInstruction  = instructionDiscriminator("refund_cancelled")
	withdrawResidualInstruction = instructionDiscriminator("withdraw_residual")
	claimRewardInstruction      = instructionDiscriminator("claim_reward")
)

type Verifier struct {
	endpoint  string
	programID string
	client    *http.Client
	wait      time.Duration
	interval  time.Duration
}

func NewVerifier(endpoint string, programID string, timeout time.Duration) (*Verifier, error) {
	endpoint = strings.TrimSpace(endpoint)
	programID = strings.TrimSpace(programID)
	if endpoint == "" {
		return nil, fmt.Errorf("%w: Solana RPC URL is required", ErrVerifierUnavailable)
	}
	if programID == "" {
		return nil, fmt.Errorf("%w: program ID is required", ErrVerifierUnavailable)
	}
	if timeout <= 0 {
		timeout = 6 * time.Second
	}
	return &Verifier{
		endpoint:  endpoint,
		programID: programID,
		client:    &http.Client{Timeout: timeout},
		wait:      20 * time.Second,
		interval:  1500 * time.Millisecond,
	}, nil
}

func (v *Verifier) VerifyCreateMarket(ctx context.Context, req models.CreateMarketRequest) error {
	tx, err := v.verifyCommon(ctx, req.Signature, req.Creator, req.PublicKey, "creator")
	if err != nil {
		return err
	}
	if !tx.matchesCreateMarketInstruction(v.programID, req) {
		return fmt.Errorf("%w: transaction does not match requested market creation", ErrVerificationFailed)
	}
	return nil
}

func (v *Verifier) VerifyTrade(ctx context.Context, req models.TradeRequest) error {
	tx, err := v.verifyCommon(ctx, req.Signature, req.Owner, req.MarketPublicKey, "owner")
	if err != nil {
		return err
	}
	if !tx.matchesTradeInstruction(v.programID, req) {
		return fmt.Errorf("%w: transaction does not match requested trade", ErrVerificationFailed)
	}
	return nil
}

func (v *Verifier) VerifyResolve(ctx context.Context, req models.ResolveMarketRequest) error {
	tx, err := v.verifyCommon(ctx, req.Signature, req.Resolver, req.MarketPublicKey, "resolver")
	if err != nil {
		return err
	}
	if !tx.matchesResolveInstruction(v.programID, req) {
		return fmt.Errorf("%w: transaction does not match requested market resolution", ErrVerificationFailed)
	}
	return nil
}

func (v *Verifier) VerifySetResolver(ctx context.Context, req models.SetMarketResolverRequest) error {
	tx, err := v.verifyCommon(ctx, req.Signature, req.Actor, req.MarketPublicKey, "resolver")
	if err != nil {
		return err
	}
	if !tx.matchesSetResolverInstruction(v.programID, req) {
		return fmt.Errorf("%w: transaction does not match requested resolver update", ErrVerificationFailed)
	}
	return nil
}

func (v *Verifier) VerifyCancel(ctx context.Context, req models.CancelMarketRequest) error {
	tx, err := v.verifyCommon(ctx, req.Signature, req.Resolver, req.MarketPublicKey, "resolver")
	if err != nil {
		return err
	}
	if !tx.matchesCancelInstruction(v.programID, req) {
		return fmt.Errorf("%w: transaction does not match requested market cancellation", ErrVerificationFailed)
	}
	return nil
}

func (v *Verifier) VerifyRedeem(ctx context.Context, req models.RedeemPositionRequest) error {
	tx, err := v.verifyCommon(ctx, req.Signature, req.Owner, req.MarketPublicKey, "owner")
	if err != nil {
		return err
	}
	if !tx.matchesRedeemInstruction(v.programID, req) {
		return fmt.Errorf("%w: transaction does not match requested redemption", ErrVerificationFailed)
	}
	return nil
}

func (v *Verifier) VerifyRefund(ctx context.Context, req models.RefundPositionRequest) error {
	tx, err := v.verifyCommon(ctx, req.Signature, req.Owner, req.MarketPublicKey, "owner")
	if err != nil {
		return err
	}
	if !tx.matchesRefundInstruction(v.programID, req) {
		return fmt.Errorf("%w: transaction does not match requested refund", ErrVerificationFailed)
	}
	return nil
}

func (v *Verifier) VerifyWithdrawResidual(ctx context.Context, req models.WithdrawResidualRequest) error {
	tx, err := v.verifyCommon(ctx, req.Signature, req.Creator, req.MarketPublicKey, "creator")
	if err != nil {
		return err
	}
	if !tx.matchesWithdrawResidualInstruction(v.programID, req) {
		return fmt.Errorf("%w: transaction does not match requested residual withdrawal", ErrVerificationFailed)
	}
	return nil
}

func (v *Verifier) verifyCommon(ctx context.Context, signature string, signer string, market string, signerLabel string) (*transactionResult, error) {
	signature = strings.TrimSpace(signature)
	signer = strings.TrimSpace(signer)
	market = strings.TrimSpace(market)
	if signature == "" || signature == "indexed" || signature == "simulated" {
		return nil, fmt.Errorf("%w: confirmed Solana signature is required", ErrVerificationFailed)
	}
	if signer == "" || signer == "local" {
		return nil, fmt.Errorf("%w: wallet %s is required", ErrVerificationFailed, signerLabel)
	}
	if market == "" {
		return nil, fmt.Errorf("%w: market public key is required", ErrVerificationFailed)
	}

	tx, err := v.waitForTransaction(ctx, signature)
	if err != nil {
		return nil, err
	}
	if tx == nil {
		return nil, fmt.Errorf("%w: transaction not found or not confirmed", ErrVerificationFailed)
	}
	if tx.Meta.hasError() {
		return nil, fmt.Errorf("%w: transaction has failed on-chain", ErrVerificationFailed)
	}
	if !tx.hasSignature(signature) {
		return nil, fmt.Errorf("%w: signature mismatch", ErrVerificationFailed)
	}
	if !tx.hasSigner(signer) {
		return nil, fmt.Errorf("%w: %s did not sign transaction", ErrVerificationFailed, signerLabel)
	}
	if !tx.referencesProgram(v.programID) {
		return nil, fmt.Errorf("%w: transaction does not reference ProbX program", ErrVerificationFailed)
	}
	return tx, nil
}

func (v *Verifier) waitForTransaction(ctx context.Context, signature string) (*transactionResult, error) {
	wait := v.wait
	if wait <= 0 {
		wait = 20 * time.Second
	}
	interval := v.interval
	if interval <= 0 {
		interval = 1500 * time.Millisecond
	}
	deadline := time.Now().Add(wait)
	for {
		tx, err := v.fetchTransaction(ctx, signature)
		if err != nil || tx != nil || time.Now().After(deadline) {
			return tx, err
		}

		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, fmt.Errorf("%w: Solana transaction confirmation timed out", ErrVerifierUnavailable)
		case <-timer.C:
		}
	}
}

func (v *Verifier) fetchTransaction(ctx context.Context, signature string) (*transactionResult, error) {
	payload := rpcRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "getTransaction",
		Params: []any{
			signature,
			map[string]any{
				"encoding":                       "jsonParsed",
				"commitment":                     "confirmed",
				"maxSupportedTransactionVersion": 0,
			},
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("%w: marshal RPC request: %v", ErrVerifierUnavailable, err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, v.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("%w: create RPC request: %v", ErrVerifierUnavailable, err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	res, err := v.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%w: Solana RPC request failed: %v", ErrVerifierUnavailable, err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("%w: Solana RPC returned HTTP %d", ErrVerifierUnavailable, res.StatusCode)
	}

	var rpc rpcResponse
	if err := json.NewDecoder(res.Body).Decode(&rpc); err != nil {
		return nil, fmt.Errorf("%w: decode RPC response: %v", ErrVerifierUnavailable, err)
	}
	if rpc.Error != nil {
		return nil, fmt.Errorf("%w: Solana RPC error %d: %s", ErrVerifierUnavailable, rpc.Error.Code, rpc.Error.Message)
	}
	return rpc.Result, nil
}

type rpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int    `json:"id"`
	Method  string `json:"method"`
	Params  []any  `json:"params"`
}

type rpcResponse struct {
	Result *transactionResult `json:"result"`
	Error  *rpcError          `json:"error"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type transactionResult struct {
	Meta        transactionMeta `json:"meta"`
	Transaction transaction     `json:"transaction"`
}

func (t transactionResult) hasSignature(signature string) bool {
	for _, item := range t.Transaction.Signatures {
		if item == signature {
			return true
		}
	}
	return false
}

func (t transactionResult) hasSigner(owner string) bool {
	for _, key := range t.Transaction.Message.AccountKeys {
		if key.Pubkey == owner && key.Signer {
			return true
		}
	}
	return false
}

func (t transactionResult) referencesProgram(programID string) bool {
	for _, key := range t.Transaction.Message.AccountKeys {
		if key.Pubkey == programID {
			return true
		}
	}
	for _, key := range t.Meta.LoadedAddresses.Writable {
		if key == programID {
			return true
		}
	}
	for _, key := range t.Meta.LoadedAddresses.Readonly {
		if key == programID {
			return true
		}
	}
	for _, instruction := range t.Transaction.Message.Instructions {
		if instruction.ProgramID == programID {
			return true
		}
	}
	for _, group := range t.Meta.InnerInstructions {
		for _, instruction := range group.Instructions {
			if instruction.ProgramID == programID {
				return true
			}
		}
	}
	return false
}

func (t transactionResult) matchesCreateMarketInstruction(programID string, req models.CreateMarketRequest) bool {
	for _, instruction := range t.tradeInstructions() {
		if instruction.matchesCreateMarket(programID, req) {
			return true
		}
	}
	return false
}

func (t transactionResult) matchesTradeInstruction(programID string, req models.TradeRequest) bool {
	for _, instruction := range t.tradeInstructions() {
		if instruction.matchesTrade(programID, req) {
			return true
		}
	}
	return false
}

func (t transactionResult) matchesResolveInstruction(programID string, req models.ResolveMarketRequest) bool {
	for _, instruction := range t.tradeInstructions() {
		if instruction.matchesResolve(programID, req) {
			return true
		}
	}
	return false
}

func (t transactionResult) matchesSetResolverInstruction(programID string, req models.SetMarketResolverRequest) bool {
	for _, instruction := range t.tradeInstructions() {
		if instruction.matchesSetResolver(programID, req) {
			return true
		}
	}
	return false
}

func (t transactionResult) matchesCancelInstruction(programID string, req models.CancelMarketRequest) bool {
	for _, instruction := range t.tradeInstructions() {
		if instruction.matchesCancel(programID, req) {
			return true
		}
	}
	return false
}

func (t transactionResult) matchesRedeemInstruction(programID string, req models.RedeemPositionRequest) bool {
	for _, instruction := range t.tradeInstructions() {
		if instruction.matchesRedeem(programID, req) {
			return true
		}
	}
	return false
}

func (t transactionResult) matchesRefundInstruction(programID string, req models.RefundPositionRequest) bool {
	for _, instruction := range t.tradeInstructions() {
		if instruction.matchesRefund(programID, req) {
			return true
		}
	}
	return false
}

func (t transactionResult) matchesWithdrawResidualInstruction(programID string, req models.WithdrawResidualRequest) bool {
	for _, instruction := range t.tradeInstructions() {
		if instruction.matchesWithdrawResidual(programID, req) {
			return true
		}
	}
	return false
}

func (t transactionResult) tradeInstructions() []instruction {
	out := append([]instruction{}, t.Transaction.Message.Instructions...)
	for _, group := range t.Meta.InnerInstructions {
		out = append(out, group.Instructions...)
	}
	return out
}

type transactionMeta struct {
	Err               json.RawMessage         `json:"err"`
	LoadedAddresses   loadedAddresses         `json:"loadedAddresses"`
	InnerInstructions []innerInstructionGroup `json:"innerInstructions"`
}

func (m transactionMeta) hasError() bool {
	raw := strings.TrimSpace(string(m.Err))
	return raw != "" && raw != "null"
}

type loadedAddresses struct {
	Writable []string `json:"writable"`
	Readonly []string `json:"readonly"`
}

type innerInstructionGroup struct {
	Instructions []instruction `json:"instructions"`
}

type transaction struct {
	Signatures []string `json:"signatures"`
	Message    message  `json:"message"`
}

type message struct {
	AccountKeys  []accountKey  `json:"accountKeys"`
	Instructions []instruction `json:"instructions"`
}

type accountKey struct {
	Pubkey string
	Signer bool
}

func (a *accountKey) UnmarshalJSON(data []byte) error {
	var pubkey string
	if err := json.Unmarshal(data, &pubkey); err == nil {
		a.Pubkey = pubkey
		return nil
	}
	var parsed struct {
		Pubkey string `json:"pubkey"`
		Signer bool   `json:"signer"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return err
	}
	a.Pubkey = parsed.Pubkey
	a.Signer = parsed.Signer
	return nil
}

type instruction struct {
	ProgramID string   `json:"programId"`
	Accounts  []string `json:"accounts"`
	Data      string   `json:"data"`
}

func (i instruction) matchesCreateMarket(programID string, req models.CreateMarketRequest) bool {
	if i.ProgramID != programID {
		return false
	}
	if !i.hasAccountAt(0, strings.TrimSpace(req.PublicKey)) {
		return false
	}
	if !i.hasAccountAt(1, strings.TrimSpace(req.Creator)) {
		return false
	}
	data, err := base58Decode(i.Data)
	if err != nil {
		return false
	}
	decoded, ok := decodeCreateMarketInstruction(data)
	if !ok {
		return false
	}
	expectedLamports := uint64(math.Round(req.InitialLiquidity * lamportsPerSOL))
	return decoded.question == strings.TrimSpace(req.Question) &&
		decoded.endTime == req.EndTime &&
		decoded.initialLiquidity == expectedLamports
}

func (i instruction) matchesTrade(programID string, req models.TradeRequest) bool {
	if i.ProgramID != programID {
		return false
	}
	market := strings.TrimSpace(req.MarketPublicKey)
	if !i.hasAccountAt(0, market) {
		return false
	}
	if !i.hasAccountAt(2, strings.TrimSpace(req.Owner)) {
		return false
	}
	data, err := base58Decode(i.Data)
	if err != nil {
		return false
	}
	decoded, ok := decodeTradeInstruction(data)
	if !ok {
		return false
	}

	action := strings.ToUpper(strings.TrimSpace(req.Action))
	if action == "" {
		action = "BUY"
	}
	side := strings.ToUpper(strings.TrimSpace(req.Side))
	if side != "YES" && side != "NO" {
		return false
	}
	sideValue := uint8(0)
	if side == "YES" {
		sideValue = 1
	}

	expectedLamports := uint64(math.Round(req.AmountSOL * lamportsPerSOL))
	if action == "BUY" && decoded.name != "buy_shares" && decoded.name != "place_bet" {
		return false
	}
	if action == "SELL" && decoded.name != "sell_shares" {
		return false
	}
	return decoded.side == sideValue && decoded.amount == expectedLamports
}

func (i instruction) matchesResolve(programID string, req models.ResolveMarketRequest) bool {
	if i.ProgramID != programID {
		return false
	}
	if req.Outcome != 0 && req.Outcome != 1 {
		return false
	}
	if !i.hasAccountAt(0, strings.TrimSpace(req.MarketPublicKey)) {
		return false
	}
	if !i.hasAccountAt(1, strings.TrimSpace(req.Resolver)) {
		return false
	}
	data, err := base58Decode(i.Data)
	if err != nil {
		return false
	}
	outcome, ok := decodeResolveInstruction(data)
	return ok && outcome == uint8(req.Outcome)
}

func (i instruction) matchesRedeem(programID string, req models.RedeemPositionRequest) bool {
	if i.ProgramID != programID {
		return false
	}
	if !i.hasAccountAt(0, strings.TrimSpace(req.MarketPublicKey)) {
		return false
	}
	owner := strings.TrimSpace(req.Owner)
	if !i.hasAccountAt(2, owner) {
		return false
	}
	data, err := base58Decode(i.Data)
	if err != nil {
		return false
	}
	return decodeRedeemInstruction(data)
}

func (i instruction) matchesSetResolver(programID string, req models.SetMarketResolverRequest) bool {
	if i.ProgramID != programID {
		return false
	}
	if !i.hasAccountAt(0, strings.TrimSpace(req.MarketPublicKey)) {
		return false
	}
	if !i.hasAccountAt(1, strings.TrimSpace(req.Actor)) {
		return false
	}
	data, err := base58Decode(i.Data)
	if err != nil {
		return false
	}
	newResolver, ok := decodeSetResolverInstruction(data)
	if !ok {
		return false
	}
	expected, err := base58Decode(strings.TrimSpace(req.NewResolver))
	if err != nil {
		return false
	}
	return bytes.Equal(newResolver, expected)
}

func (i instruction) matchesCancel(programID string, req models.CancelMarketRequest) bool {
	if i.ProgramID != programID {
		return false
	}
	if !i.hasAccountAt(0, strings.TrimSpace(req.MarketPublicKey)) {
		return false
	}
	if !i.hasAccountAt(1, strings.TrimSpace(req.Resolver)) {
		return false
	}
	data, err := base58Decode(i.Data)
	if err != nil {
		return false
	}
	return decodeCancelInstruction(data)
}

func (i instruction) matchesRefund(programID string, req models.RefundPositionRequest) bool {
	if i.ProgramID != programID {
		return false
	}
	if !i.hasAccountAt(0, strings.TrimSpace(req.MarketPublicKey)) {
		return false
	}
	owner := strings.TrimSpace(req.Owner)
	if !i.hasAccountAt(2, owner) {
		return false
	}
	data, err := base58Decode(i.Data)
	if err != nil {
		return false
	}
	return decodeRefundInstruction(data)
}

func (i instruction) matchesWithdrawResidual(programID string, req models.WithdrawResidualRequest) bool {
	if i.ProgramID != programID {
		return false
	}
	if !i.hasAccountAt(0, strings.TrimSpace(req.MarketPublicKey)) {
		return false
	}
	if !i.hasAccountAt(1, strings.TrimSpace(req.Creator)) {
		return false
	}
	data, err := base58Decode(i.Data)
	if err != nil {
		return false
	}
	return decodeWithdrawResidualInstruction(data)
}

func (i instruction) hasAccountAt(index int, value string) bool {
	return value != "" && len(i.Accounts) > index && i.Accounts[index] == value
}

type createMarketInstructionData struct {
	question         string
	endTime          int64
	initialLiquidity uint64
}

type tradeInstruction struct {
	name   string
	amount uint64
	side   uint8
}

func decodeCreateMarketInstruction(data []byte) (createMarketInstructionData, bool) {
	if len(data) < 28 || !bytes.Equal(data[:8], createMarketInstruction) {
		return createMarketInstructionData{}, false
	}
	offset := 8
	questionLength := int(binary.LittleEndian.Uint32(data[offset : offset+4]))
	offset += 4
	if questionLength < 0 || offset+questionLength+16 > len(data) {
		return createMarketInstructionData{}, false
	}
	question := string(data[offset : offset+questionLength])
	offset += questionLength
	endTime := int64(binary.LittleEndian.Uint64(data[offset : offset+8]))
	offset += 8
	initialLiquidity := binary.LittleEndian.Uint64(data[offset : offset+8])
	offset += 8
	if offset != len(data) {
		return createMarketInstructionData{}, false
	}
	return createMarketInstructionData{
		question:         question,
		endTime:          endTime,
		initialLiquidity: initialLiquidity,
	}, true
}

func decodeTradeInstruction(data []byte) (tradeInstruction, bool) {
	if len(data) < 17 {
		return tradeInstruction{}, false
	}
	discriminator := data[:8]
	switch {
	case bytes.Equal(discriminator, buySharesInstruction):
		return tradeInstruction{
			name:   "buy_shares",
			amount: binary.LittleEndian.Uint64(data[8:16]),
			side:   data[16],
		}, true
	case bytes.Equal(discriminator, sellSharesInstruction):
		return tradeInstruction{
			name:   "sell_shares",
			amount: binary.LittleEndian.Uint64(data[8:16]),
			side:   data[16],
		}, true
	case bytes.Equal(discriminator, placeBetInstruction):
		return tradeInstruction{
			name:   "place_bet",
			amount: binary.LittleEndian.Uint64(data[8:16]),
			side:   data[16],
		}, true
	default:
		return tradeInstruction{}, false
	}
}

func decodeResolveInstruction(data []byte) (uint8, bool) {
	if len(data) != 9 || !bytes.Equal(data[:8], resolveMarketInstruction) {
		return 0, false
	}
	return data[8], true
}

func decodeSetResolverInstruction(data []byte) ([]byte, bool) {
	if len(data) != 40 || !bytes.Equal(data[:8], setResolverInstruction) {
		return nil, false
	}
	return data[8:40], true
}

func decodeCancelInstruction(data []byte) bool {
	return len(data) == 8 && bytes.Equal(data[:8], cancelMarketInstruction)
}

func decodeRedeemInstruction(data []byte) bool {
	if len(data) != 8 {
		return false
	}
	discriminator := data[:8]
	return bytes.Equal(discriminator, redeemWinningsInstruction) || bytes.Equal(discriminator, claimRewardInstruction)
}

func decodeRefundInstruction(data []byte) bool {
	return len(data) == 8 && bytes.Equal(data[:8], refundCancelledInstruction)
}

func decodeWithdrawResidualInstruction(data []byte) bool {
	return len(data) == 8 && bytes.Equal(data[:8], withdrawResidualInstruction)
}

func instructionDiscriminator(name string) []byte {
	hash := sha256.Sum256([]byte("global:" + name))
	return hash[:8]
}
