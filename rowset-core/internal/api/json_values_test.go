package api

import (
	"encoding/json"
	"testing"
)

func TestBrowserValuesPreserveNumericPrecision(t *testing.T) {
	data, err := json.Marshal(browserRow([]any{int64(9007199254740993), uint64(18446744073709551615), int64(42), "1234567890.1234567890", nil}))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != `["9007199254740993","18446744073709551615",42,"1234567890.1234567890",null]` {
		t.Fatal(string(data))
	}
}
