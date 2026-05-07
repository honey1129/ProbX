package config

import (
	"os"
	"testing"
)

func TestLoadReadsDotEnv(t *testing.T) {
	unsetEnv(t,
		"PROBX_HTTP_ADDR",
		"PROBX_DATABASE_DSN",
		"PROBX_CORS_ORIGINS",
		"PROBX_SOLANA_RPC_URL",
		"PROBX_PROGRAM_ID",
		"PROBX_TRADE_VERIFICATION",
	)
	chdir(t, t.TempDir())
	writeDotEnv(t, `
PROBX_HTTP_ADDR=:9090
PROBX_DATABASE_DSN='user:pass@tcp(127.0.0.1:3306)/probx?parseTime=true&multiStatements=true'
PROBX_CORS_ORIGINS=http://localhost:3000, https://app.probx.example
PROBX_SOLANA_RPC_URL=https://api.devnet.solana.com
PROBX_PROGRAM_ID=program_abc
PROBX_TRADE_VERIFICATION=CONFIRMED
`)

	cfg := Load()
	if cfg.HTTPAddr != ":9090" {
		t.Fatalf("expected HTTP addr from .env, got %q", cfg.HTTPAddr)
	}
	if cfg.DatabaseDSN != "user:pass@tcp(127.0.0.1:3306)/probx?parseTime=true&multiStatements=true" {
		t.Fatalf("expected database DSN from .env, got %q", cfg.DatabaseDSN)
	}
	if cfg.SolanaRPCURL != "https://api.devnet.solana.com" || cfg.ProgramID != "program_abc" {
		t.Fatalf("unexpected chain config: %+v", cfg)
	}
	if cfg.TradeVerification != "confirmed" {
		t.Fatalf("expected normalized trade verification, got %q", cfg.TradeVerification)
	}
	if len(cfg.CORSOrigins) != 2 || cfg.CORSOrigins[1] != "https://app.probx.example" {
		t.Fatalf("unexpected CORS origins: %+v", cfg.CORSOrigins)
	}
}

func TestLoadKeepsExistingEnvironmentOverDotEnv(t *testing.T) {
	unsetEnv(t, "PROBX_HTTP_ADDR")
	chdir(t, t.TempDir())
	writeDotEnv(t, "PROBX_HTTP_ADDR=:9090\n")

	original, hadOriginal := os.LookupEnv("PROBX_HTTP_ADDR")
	if err := os.Setenv("PROBX_HTTP_ADDR", ":7070"); err != nil {
		t.Fatalf("set env: %v", err)
	}
	t.Cleanup(func() {
		if hadOriginal {
			_ = os.Setenv("PROBX_HTTP_ADDR", original)
		} else {
			_ = os.Unsetenv("PROBX_HTTP_ADDR")
		}
	})

	cfg := Load()
	if cfg.HTTPAddr != ":7070" {
		t.Fatalf("expected existing env to win, got %q", cfg.HTTPAddr)
	}
}

func writeDotEnv(t *testing.T, content string) {
	t.Helper()
	if err := os.WriteFile(".env", []byte(content), 0o600); err != nil {
		t.Fatalf("write .env: %v", err)
	}
}

func chdir(t *testing.T, path string) {
	t.Helper()
	previous, err := os.Getwd()
	if err != nil {
		t.Fatalf("get cwd: %v", err)
	}
	if err := os.Chdir(path); err != nil {
		t.Fatalf("chdir: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previous)
	})
}

func unsetEnv(t *testing.T, keys ...string) {
	t.Helper()
	previous := make(map[string]string, len(keys))
	present := make(map[string]bool, len(keys))
	for _, key := range keys {
		if value, ok := os.LookupEnv(key); ok {
			previous[key] = value
			present[key] = true
		}
		_ = os.Unsetenv(key)
	}
	t.Cleanup(func() {
		for _, key := range keys {
			if present[key] {
				_ = os.Setenv(key, previous[key])
			} else {
				_ = os.Unsetenv(key)
			}
		}
	})
}
