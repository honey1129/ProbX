package chain

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"probx/backend/internal/models"
)

var (
	ErrVerificationFailed  = errors.New("transaction verification failed")
	ErrVerifierUnavailable = errors.New("transaction verifier unavailable")
)

type Verifier struct {
	endpoint  string
	programID string
	client    *http.Client
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
	}, nil
}

func (v *Verifier) VerifyTrade(ctx context.Context, req models.TradeRequest) error {
	signature := strings.TrimSpace(req.Signature)
	owner := strings.TrimSpace(req.Owner)
	if signature == "" || signature == "indexed" || signature == "simulated" {
		return fmt.Errorf("%w: confirmed Solana signature is required", ErrVerificationFailed)
	}
	if owner == "" || owner == "local" {
		return fmt.Errorf("%w: wallet owner is required", ErrVerificationFailed)
	}

	tx, err := v.fetchTransaction(ctx, signature)
	if err != nil {
		return err
	}
	if tx == nil {
		return fmt.Errorf("%w: transaction not found or not confirmed", ErrVerificationFailed)
	}
	if tx.Meta.hasError() {
		return fmt.Errorf("%w: transaction has failed on-chain", ErrVerificationFailed)
	}
	if !tx.hasSignature(signature) {
		return fmt.Errorf("%w: signature mismatch", ErrVerificationFailed)
	}
	if !tx.hasSigner(owner) {
		return fmt.Errorf("%w: owner did not sign transaction", ErrVerificationFailed)
	}
	if !tx.referencesProgram(v.programID) {
		return fmt.Errorf("%w: transaction does not reference ProbX program", ErrVerificationFailed)
	}
	return nil
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
	ProgramID string `json:"programId"`
}
