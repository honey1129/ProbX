package models

const ProgramEventsCursorName = "program_events"

type Market struct {
	ID                 string    `json:"id"`
	PublicKey          string    `json:"publicKey"`
	Creator            string    `json:"creator"`
	EndTime            int64     `json:"endTime"`
	Question           string    `json:"question"`
	Category           string    `json:"category"`
	AvatarURL          string    `json:"avatarUrl,omitempty"`
	YesPool            float64   `json:"yesPool"`
	NoPool             float64   `json:"noPool"`
	TotalLiquidity     float64   `json:"totalLiquidity"`
	Volume24h          float64   `json:"volume24h"`
	Participants       int       `json:"participants"`
	Change24h          float64   `json:"change24h"`
	Resolved           bool      `json:"resolved,omitempty"`
	Outcome            *int      `json:"outcome,omitempty"`
	ProbabilityHistory []float64 `json:"probabilityHistory"`
}

type Position struct {
	ID                 string  `json:"id"`
	MarketID           string  `json:"marketId"`
	Side               string  `json:"side"`
	Size               float64 `json:"size"`
	EntryProbability   float64 `json:"entryProbability"`
	CurrentProbability float64 `json:"currentProbability"`
	PnL                float64 `json:"pnl"`
	Resolved           bool    `json:"resolved,omitempty"`
}

type AgentActivity struct {
	ID         string  `json:"id"`
	Agent      string  `json:"agent"`
	MarketID   string  `json:"marketId"`
	Side       string  `json:"side"`
	Action     string  `json:"action"`
	Size       float64 `json:"size"`
	Confidence int     `json:"confidence"`
	Timestamp  int64   `json:"timestamp"`
}

type Trade struct {
	ID        string  `json:"id"`
	Owner     string  `json:"owner"`
	MarketID  string  `json:"marketId"`
	Side      string  `json:"side"`
	Action    string  `json:"action"`
	AmountSOL float64 `json:"amountSol"`
	Price     float64 `json:"price"`
	Signature string  `json:"signature"`
	Status    string  `json:"status"`
	CreatedAt int64   `json:"createdAt"`
}

type TradeFilter struct {
	Owner     string
	MarketID  string
	Signature string
	Side      string
	Action    string
	Status    string
	Limit     int
	Cursor    string
}

type TradePage struct {
	Trades     []Trade `json:"trades"`
	NextCursor string  `json:"nextCursor,omitempty"`
}

type Bootstrap struct {
	Markets   []Market        `json:"markets"`
	Positions []Position      `json:"positions"`
	Activity  []AgentActivity `json:"activity"`
}

type CreateMarketRequest struct {
	ID               string  `json:"id"`
	PublicKey        string  `json:"publicKey"`
	Creator          string  `json:"creator"`
	Question         string  `json:"question"`
	Category         string  `json:"category"`
	AvatarURL        string  `json:"avatarUrl"`
	EndTime          int64   `json:"endTime"`
	InitialLiquidity float64 `json:"initialLiquidity"`
	Signature        string  `json:"signature"`
	Status           string  `json:"status"`
}

type UpdateMarketMetadataRequest struct {
	Actor     string `json:"actor"`
	Category  string `json:"category"`
	AvatarURL string `json:"avatarUrl"`
	Message   string `json:"message"`
	Signature string `json:"signature"`
}

type TradeRequest struct {
	MarketID        string  `json:"marketId"`
	MarketPublicKey string  `json:"-"`
	Owner           string  `json:"owner"`
	Side            string  `json:"side"`
	AmountSOL       float64 `json:"amountSol"`
	Action          string  `json:"action"`
	Signature       string  `json:"signature"`
	Status          string  `json:"status"`
}

type TradeResponse struct {
	Signature string        `json:"signature"`
	Status    string        `json:"status"`
	Market    Market        `json:"market"`
	Position  Position      `json:"position"`
	Activity  AgentActivity `json:"activity"`
}

type ResolveMarketRequest struct {
	MarketPublicKey string `json:"-"`
	Resolver        string `json:"resolver"`
	Outcome         int    `json:"outcome"`
	Signature       string `json:"signature"`
	Status          string `json:"status"`
}

type RedeemPositionRequest struct {
	MarketPublicKey string `json:"-"`
	Owner           string `json:"owner"`
	Signature       string `json:"signature"`
	Status          string `json:"status"`
}

type RedeemPositionResponse struct {
	Signature string   `json:"signature"`
	Status    string   `json:"status"`
	Market    Market   `json:"market"`
	Position  Position `json:"position"`
}

type IndexedPosition struct {
	PublicKey       string
	Owner           string
	MarketPublicKey string
	YesAmount       float64
	NoAmount        float64
}

type IndexedEvent struct {
	ID               string
	Signature        string
	Slot             uint64
	Type             string
	InstructionIndex int
	OnchainID        uint64
	MarketPublicKey  string
	Owner            string
	Resolver         string
	Question         string
	EndTime          int64
	Side             string
	Action           string
	AmountSOL        float64
	Shares           float64
	PayoutSOL        float64
	Outcome          *int
	YesPool          float64
	NoPool           float64
	TotalLiquidity   float64
	PriceAfter       float64
	TimestampMillis  int64
}

type IndexerCursor struct {
	Signature string `json:"signature"`
	Slot      uint64 `json:"slot"`
	UpdatedAt int64  `json:"updatedAt"`
}
