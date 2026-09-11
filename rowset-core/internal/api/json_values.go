package api

import (
	"encoding/json"
	"strconv"
)

// Only the browser transport converts unsafe integers. Other transports keep
// the driver's typed values. Decimal driver strings are already lossless.
func browserValue(value any) any {
	const safe = 9007199254740991
	switch v := value.(type) {
	case int64:
		if v > safe || v < -safe {
			return strconv.FormatInt(v, 10)
		}
	case uint64:
		if v > safe {
			return strconv.FormatUint(v, 10)
		}
	case json.Number:
		return string(v)
	}
	return value
}

func browserRow(row []any) []any {
	result := make([]any, len(row))
	for i, value := range row {
		result[i] = browserValue(value)
	}
	return result
}
