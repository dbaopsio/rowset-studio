// Package rowlimit caps the number of rows a SELECT may return by rewriting
// its LIMIT (or SQL Server TOP) clause.
package rowlimit

import (
	"fmt"
	"strconv"
	"strings"

	sqlguard "github.com/dbaopsio/rowset-studio/rowset-parser"
)

// Apply returns the statement with at most limit rows. Non-SELECT statements
// and non-positive limits are returned unchanged.
func Apply(engine string, info sqlguard.Info, limit int) (string, error) {
	if limit <= 0 || info.Kind != sqlguard.Select {
		return info.Raw, nil
	}
	engine = strings.ToLower(engine)
	if engine == "mssql" || engine == "sqlserver" {
		for index, token := range info.Tokens {
			if token.Depth == 0 && token.Lower == "select" {
				if index+1 < len(info.Tokens) && info.Tokens[index+1].Lower == "top" {
					return info.Raw, nil
				}
				return info.Raw[:token.End] + " TOP (" + strconv.Itoa(limit) + ")" + info.Raw[token.End:], nil
			}
		}
		return "", fmt.Errorf("SQL Server limit policy supports plain SELECT statements")
	}
	for index, token := range info.Tokens {
		if token.Depth != 0 || token.Lower != "limit" {
			continue
		}
		if index+1 >= len(info.Tokens) {
			return "", fmt.Errorf("invalid LIMIT")
		}
		current, err := strconv.Atoi(info.Tokens[index+1].Text)
		if err != nil {
			return "", fmt.Errorf("non-numeric LIMIT cannot be safely capped")
		}
		if current <= limit {
			return info.Raw, nil
		}
		next := info.Tokens[index+1]
		return info.Raw[:next.Start] + strconv.Itoa(limit) + info.Raw[next.End:], nil
	}
	return strings.TrimSpace(info.Raw) + " LIMIT " + strconv.Itoa(limit), nil
}
