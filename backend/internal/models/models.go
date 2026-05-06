package models

type Market struct {
	ID                 string    `json:"id"`
	PublicKey          string    `json:"publicKey"`
	Creator            string    `json:"creator"`
	EndTime            int64     `json:"endTime"`
	Question           string    `json:"question"`
	Category           string    `json:"category"`
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
	EndTime          int64   `json:"endTime"`
	InitialLiquidity float64 `json:"initialLiquidity"`
}

type TradeRequest struct {
	MarketID  string  `json:"marketId"`
	Owner     string  `json:"owner"`
	Side      string  `json:"side"`
	AmountSOL float64 `json:"amountSol"`
	Action    string  `json:"action"`
	Signature string  `json:"signature"`
	Status    string  `json:"status"`
}

type TradeResponse struct {
	Signature string        `json:"signature"`
	Status    string        `json:"status"`
	Market    Market        `json:"market"`
	Position  Position      `json:"position"`
	Activity  AgentActivity `json:"activity"`
}
