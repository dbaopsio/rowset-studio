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
// and non-positive limits are returned unchanged. A statement that already
// asks for fewer rows is left alone.
func Apply(engine string, info sqlguard.Info, limit int) (string, error) {
	if limit <= 0 || info.Kind != sqlguard.Select {
		return info.Raw, nil
	}
	if strings.EqualFold(engine, "mssql") || strings.EqualFold(engine, "sqlserver") {
		return applyTop(info, limit)
	}
	return applyLimit(info, limit)
}

// applyTop writes TOP (n) after SELECT [ALL | DISTINCT], where T-SQL expects
// it. The first select at depth 0 is the outermost one, also after a CTE.
// T-SQL rejects TOP next to OFFSET/FETCH paging and to NEXT VALUE FOR, so
// those statements are capped through FETCH or left alone.
func applyTop(info sqlguard.Info, limit int) (string, error) {
	for index, token := range info.Tokens {
		if token.Lower == "next" && index+1 < len(info.Tokens) && info.Tokens[index+1].Lower == "value" {
			return info.Raw, nil
		}
		if token.Depth == 0 && token.Lower == "fetch" {
			return applyLimit(info, limit)
		}
	}
	for index, token := range info.Tokens {
		if token.Depth != 0 || token.Lower != "select" {
			continue
		}
		end := token.End
		for next := index + 1; next < len(info.Tokens); next++ {
			switch info.Tokens[next].Lower {
			case "all", "distinct":
				end = info.Tokens[next].End
				continue
			case "top":
				return info.Raw, nil
			}
			break
		}
		return info.Raw[:end] + " TOP (" + strconv.Itoa(limit) + ")" + info.Raw[end:], nil
	}
	return "", fmt.Errorf("this statement has no SELECT to limit")
}

// applyLimit caps an existing LIMIT or FETCH FIRST, or adds LIMIT before a
// locking clause, which must stay last.
func applyLimit(info sqlguard.Info, limit int) (string, error) {
	for index, token := range info.Tokens {
		if token.Depth != 0 || (token.Lower != "limit" && token.Lower != "fetch") {
			continue
		}
		count := index + 1
		if token.Lower == "fetch" {
			// FETCH FIRST | NEXT n ROWS ONLY
			for count < len(info.Tokens) && (info.Tokens[count].Lower == "first" || info.Tokens[count].Lower == "next") {
				count++
			}
		} else if index+2 < len(info.Tokens) && info.Tokens[index+2].Text == "," {
			count = index + 3 // MySQL LIMIT offset, count
		}
		if count >= len(info.Tokens) {
			return "", fmt.Errorf("invalid row limit in the statement")
		}
		current, err := strconv.Atoi(info.Tokens[count].Text)
		if err != nil {
			return "", fmt.Errorf("a non-numeric row limit cannot be capped safely")
		}
		if current <= limit {
			return info.Raw, nil
		}
		return info.Raw[:info.Tokens[count].Start] + strconv.Itoa(limit) + info.Raw[info.Tokens[count].End:], nil
	}
	// FOR UPDATE, FOR SHARE, LOCK IN SHARE MODE and INTO OUTFILE end the
	// statement, so LIMIT goes before them.
	for _, token := range info.Tokens {
		if token.Depth == 0 && (token.Lower == "for" || token.Lower == "lock" || token.Lower == "into") {
			return strings.TrimSpace(info.Raw[:token.Start]) + " LIMIT " + strconv.Itoa(limit) + " " + info.Raw[token.Start:], nil
		}
	}
	return strings.TrimSpace(info.Raw) + " LIMIT " + strconv.Itoa(limit), nil
}
