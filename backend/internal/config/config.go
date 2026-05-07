package config

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	HTTPAddr          string
	DatabaseDSN       string
	CORSOrigins       []string
	SolanaRPCURL      string
	ProgramID         string
	TradeVerification string
}

func Load() Config {
	loadDotEnv()

	return Config{
		HTTPAddr:          env("PROBX_HTTP_ADDR", ":8080"),
		DatabaseDSN:       env("PROBX_DATABASE_DSN", "probx:probx@tcp(127.0.0.1:3306)/probx?parseTime=true&multiStatements=true"),
		CORSOrigins:       splitCSV(env("PROBX_CORS_ORIGINS", "http://localhost:3000")),
		SolanaRPCURL:      env("PROBX_SOLANA_RPC_URL", "http://127.0.0.1:8899"),
		ProgramID:         env("PROBX_PROGRAM_ID", "4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL"),
		TradeVerification: strings.ToLower(env("PROBX_TRADE_VERIFICATION", "off")),
	}
}

func loadDotEnv() {
	for _, path := range []string{".env", "backend/.env"} {
		loadDotEnvFile(path)
	}
}

func loadDotEnvFile(path string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		applyDotEnvLine(scanner.Text())
	}
}

func applyDotEnvLine(line string) {
	line = strings.TrimSpace(line)
	if line == "" || strings.HasPrefix(line, "#") {
		return
	}
	if strings.HasPrefix(line, "export ") {
		line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
	}

	key, value, ok := strings.Cut(line, "=")
	if !ok {
		return
	}
	key = strings.TrimSpace(key)
	if key == "" {
		return
	}
	if _, exists := os.LookupEnv(key); exists {
		return
	}
	_ = os.Setenv(key, parseDotEnvValue(value))
}

func parseDotEnvValue(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 2 {
		quote := value[0]
		if quote == '\'' || quote == '"' {
			for i := 1; i < len(value); i++ {
				if value[i] != quote {
					continue
				}
				quoted := value[:i+1]
				if quote == '"' {
					if unquoted, err := strconv.Unquote(quoted); err == nil {
						return unquoted
					}
				}
				return quoted[1 : len(quoted)-1]
			}
		}
	}
	if index := strings.Index(value, " #"); index >= 0 {
		value = value[:index]
	}
	return strings.TrimSpace(value)
}

func env(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
