package mysqlstore

import "testing"

func TestIsSyntheticSignature(t *testing.T) {
	tests := []struct {
		signature string
		want      bool
	}{
		{"", true},
		{"indexed", true},
		{"simulated", true},
		{"local", true},
		{"  indexed  ", true},
		{"5r9xRealSignature", false},
	}

	for _, tt := range tests {
		if got := isSyntheticSignature(tt.signature); got != tt.want {
			t.Fatalf("isSyntheticSignature(%q) = %v, want %v", tt.signature, got, tt.want)
		}
	}
}
