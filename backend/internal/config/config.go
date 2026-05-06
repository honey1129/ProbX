package config

import (
	"os"
	"strings"
)

type Config struct {
	HTTPAddr    string
	DatabaseDSN string
	CORSOrigins []string
}

func Load() Config {
	return Config{
		HTTPAddr:    env("PROBX_HTTP_ADDR", ":8080"),
		DatabaseDSN: env("PROBX_DATABASE_DSN", "probx:probx@tcp(127.0.0.1:3306)/probx?parseTime=true&multiStatements=true"),
		CORSOrigins: splitCSV(env("PROBX_CORS_ORIGINS", "http://localhost:3000")),
	}
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
