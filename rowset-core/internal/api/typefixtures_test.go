package api

import (
	"strings"
)

// typeColumn is one column of the all-types table: its SQL type and the
// literal written for the full row and for the edge-value row. Computed
// columns are derived by the database and never written; volatile ones
// change on every write and are left out of comparisons.
type typeColumn struct {
	name, sqlType string
	full, edge    string
	computed      bool
	volatile      bool
	// csvLossy columns cannot survive a CSV round trip unchanged.
	csvLossy bool
}

// typeFixture is a table holding every commonly used column type of one
// engine. Types may use {suffix} for per-run names such as enum types.
type typeFixture struct {
	setup   []string // run before the table is created; {suffix} is replaced
	id      string   // definition of the id primary key column
	options string   // table options after the column list
	columns []typeColumn
	update  string // SET clause of the UPDATE that is backed up and restored
}

func nulls(count int) string {
	return strings.TrimSuffix(strings.Repeat("NULL, ", count), ", ")
}

func (f typeFixture) statements(table, suffix string) []string {
	var out []string
	for _, statement := range f.setup {
		out = append(out, strings.ReplaceAll(statement, "{suffix}", suffix))
	}
	definitions := []string{"id " + f.id}
	for _, column := range f.columns {
		definitions = append(definitions, column.name+" "+strings.ReplaceAll(column.sqlType, "{suffix}", suffix))
	}
	return append(out, "CREATE TABLE "+table+" ("+strings.Join(definitions, ", ")+")"+f.options)
}

func (f typeFixture) writable() []string {
	var out []string
	for _, column := range f.columns {
		if !column.computed {
			out = append(out, column.name)
		}
	}
	return out
}

func (f typeFixture) compared() []string {
	var out []string
	for _, column := range f.columns {
		if !column.volatile {
			out = append(out, column.name)
		}
	}
	return out
}

// importCompared are the columns a CSV round trip keeps. CSV carries no
// types, so sql_variant values come back as text.
func (f typeFixture) importCompared() []string {
	var out []string
	for _, column := range f.columns {
		if !column.volatile && !column.csvLossy {
			out = append(out, column.name)
		}
	}
	return out
}

// rowValues returns the value lists of the rows every test writes: full,
// edge values, all NULL, and full again.
func (f typeFixture) rowValues() []string {
	var full, edge []string
	for _, column := range f.columns {
		if !column.computed {
			full, edge = append(full, column.full), append(edge, column.edge)
		}
	}
	fullRow, edgeRow := strings.Join(full, ", "), strings.Join(edge, ", ")
	return []string{fullRow, edgeRow, nulls(len(full)), fullRow}
}

var mysqlTypeColumns = []typeColumn{
	{name: "c_tinyint", sqlType: "tinyint", full: "1", edge: "-128"},
	{name: "c_smallint", sqlType: "smallint", full: "2", edge: "-32768"},
	{name: "c_mediumint", sqlType: "mediumint", full: "3", edge: "-8388608"},
	{name: "c_int", sqlType: "int", full: "4", edge: "-1"},
	{name: "c_bigint", sqlType: "bigint", full: "9223372036854775807", edge: "-9223372036854775808"},
	{name: "c_ubigint", sqlType: "bigint unsigned", full: "18446744073709551615", edge: "0"},
	{name: "c_decimal", sqlType: "decimal(12,4)", full: "12345678.1234", edge: "-0.0001"},
	{name: "c_bigdec", sqlType: "decimal(65,30)", full: "12345678901234567890123456789012345.123456789012345678901234567890", edge: "-0.000000000000000000000000000001"},
	{name: "c_float", sqlType: "float", full: "1.5", edge: "-1.25e10"},
	{name: "c_double", sqlType: "double", full: "2.25", edge: "1e-300"},
	{name: "c_bit", sqlType: "bit(4)", full: "b'1010'", edge: "b'0000'"},
	{name: "c_bit64", sqlType: "bit(64)", full: "b'1111111111111111111111111111111111111111111111111111111111111111'", edge: "b'0'"},
	{name: "c_bool", sqlType: "boolean", full: "true", edge: "false"},
	{name: "c_char", sqlType: "char(3)", full: "'abc'", edge: "'x'"},
	{name: "c_varchar", sqlType: "varchar(50)", full: "'Ayşe O''Neil'", edge: "''"},
	{name: "c_tinytext", sqlType: "tinytext", full: "'tiny'", edge: "''"},
	{name: "c_text", sqlType: "text", full: `'line1\nline2 \\ back'`, edge: `'ğüşİ 😀 ''q'' "dq"'`},
	{name: "c_mediumtext", sqlType: "mediumtext", full: "'medium'", edge: "''"},
	{name: "c_longtext", sqlType: "longtext", full: "REPEAT('long ', 2000)", edge: "''"},
	{name: "c_date", sqlType: "date", full: "'2024-02-29'", edge: "'1000-01-01'"},
	{name: "c_time", sqlType: "time(3)", full: "'13:45:10.123'", edge: "'-838:59:59.000'"},
	{name: "c_time6", sqlType: "time(6)", full: "'12:00:00.654321'", edge: "'838:59:59.000000'"},
	{name: "c_datetime", sqlType: "datetime(3)", full: "'2024-03-01 10:15:30.250'", edge: "'1970-01-01 00:00:00.000'"},
	{name: "c_datetime6", sqlType: "datetime(6)", full: "'2024-03-01 10:15:30.123456'", edge: "'9999-12-31 23:59:59.999999'"},
	{name: "c_timestamp", sqlType: "timestamp(3) NULL", full: "'2024-03-01 10:15:30.250'", edge: "'1970-01-02 00:00:00.000'"},
	{name: "c_year", sqlType: "year", full: "2024", edge: "1901"},
	{name: "c_json", sqlType: "json", full: `'{"a": "x\\"y", "b": [1, 2], "n": {"deep": [null, true]}}'`, edge: "'[]'"},
	{name: "c_binary", sqlType: "binary(4)", full: "X'00FF1000'", edge: "X'00000000'"},
	{name: "c_varbinary", sqlType: "varbinary(16)", full: "X'00FF10'", edge: "X''"},
	{name: "c_tinyblob", sqlType: "tinyblob", full: "X'01'", edge: "X''"},
	{name: "c_blob", sqlType: "blob", full: "X'616263'", edge: "X''"},
	{name: "c_mediumblob", sqlType: "mediumblob", full: "X'0203'", edge: "X''"},
	{name: "c_longblob", sqlType: "longblob", full: "X'040506'", edge: "X''"},
	{name: "c_enum", sqlType: "enum('sad','ok','happy')", full: "'happy'", edge: "'sad'"},
	{name: "c_set", sqlType: "set('x','y','z')", full: "'x,z'", edge: "''"},
	{name: "c_point", sqlType: "point NULL", full: "ST_GeomFromText('POINT(1 2)')", edge: "ST_GeomFromText('POINT(0 0)')"},
	{name: "c_linestring", sqlType: "linestring NULL", full: "ST_GeomFromText('LINESTRING(0 0,1 1,2 2)')", edge: "ST_GeomFromText('LINESTRING(0 0,0 1)')"},
	{name: "c_polygon", sqlType: "polygon NULL", full: "ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))')", edge: "ST_GeomFromText('POLYGON((0 0,2 0,2 2,0 2,0 0),(1 1,1 1.5,1.5 1.5,1 1))')"},
	{name: "c_geometry", sqlType: "geometry NULL", full: "ST_GeomFromText('POINT(3 4)')", edge: "ST_GeomFromText('LINESTRING(5 5,6 6)')"},
	{name: "c_multipoint", sqlType: "multipoint NULL", full: "ST_GeomFromText('MULTIPOINT((1 1),(2 2))')", edge: "ST_GeomFromText('MULTIPOINT((0 0))')"},
	{name: "c_geomcoll", sqlType: "geometrycollection NULL", full: "ST_GeomFromText('GEOMETRYCOLLECTION(POINT(1 1),LINESTRING(0 0,1 1))')", edge: "ST_GeomFromText('GEOMETRYCOLLECTION(POINT(0 0))')"},
}

func withColumns(base []typeColumn, extra ...typeColumn) []typeColumn {
	return append(append([]typeColumn(nil), base...), extra...)
}

var generatedIntColumn = typeColumn{name: "c_generated", sqlType: "int GENERATED ALWAYS AS (c_int * 2) STORED", computed: true}

var typeFixtures = map[string]typeFixture{
	"postgres": {
		setup: []string{"CREATE TYPE mood_{suffix} AS ENUM ('sad', 'ok', 'happy')"},
		id:    "int GENERATED ALWAYS AS IDENTITY PRIMARY KEY",
		columns: []typeColumn{
			{name: "c_smallint", sqlType: "smallint", full: "1", edge: "-32768"},
			{name: "c_int", sqlType: "integer", full: "2", edge: "-1"},
			{name: "c_bigint", sqlType: "bigint", full: "9223372036854775807", edge: "-9223372036854775808"},
			{name: "c_numeric", sqlType: "numeric(12,4)", full: "12345678.1234", edge: "-0.0001"},
			{name: "c_big_numeric", sqlType: "numeric(38,10)", full: "1234567890123456789012345678.1234567890", edge: "-0.0000000001"},
			{name: "c_numeric_special", sqlType: "numeric", full: "'NaN'", edge: "'-Infinity'"},
			{name: "c_real", sqlType: "real", full: "1.5", edge: "'Infinity'"},
			{name: "c_double", sqlType: "double precision", full: "2.25", edge: "1e-300"},
			{name: "c_double_special", sqlType: "double precision", full: "'NaN'", edge: "'-Infinity'"},
			{name: "c_money", sqlType: "money", full: "12.34", edge: "-5.5"},
			{name: "c_bool", sqlType: "boolean", full: "true", edge: "false"},
			{name: "c_char", sqlType: "char(3)", full: "'abc'", edge: "'x'"},
			{name: "c_char1", sqlType: `"char"`, full: "'x'", edge: "' '"},
			{name: "c_varchar", sqlType: "varchar(50)", full: "'Ayşe O''Neil'", edge: "''"},
			{name: "c_text", sqlType: "text", full: "'line1\nline2 \\ back'", edge: `'ğüşİ 😀 ''q'' "dq"'`},
			{name: "c_name", sqlType: "name", full: "'pg_name'", edge: "''"},
			{name: "c_date", sqlType: "date", full: "'2024-02-29'", edge: "'1999-12-31'"},
			{name: "c_time", sqlType: "time(3)", full: "'13:45:10.123'", edge: "'00:00:00'"},
			{name: "c_timetz", sqlType: "timetz", full: "'13:45:10.123+03'", edge: "'00:00:00+00'"},
			{name: "c_timestamp", sqlType: "timestamp(3)", full: "'2024-03-01 10:15:30.250'", edge: "'1970-01-01 00:00:00'"},
			{name: "c_timestamp_inf", sqlType: "timestamp", full: "'infinity'", edge: "'-infinity'"},
			{name: "c_timestamptz", sqlType: "timestamptz(3)", full: "'2024-03-01 10:15:30.25+03'", edge: "'1970-01-01 00:00:00+00'"},
			{name: "c_interval", sqlType: "interval", full: "'1 day 02:03:04'", edge: "'-3 months'"},
			{name: "c_uuid", sqlType: "uuid", full: "'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'", edge: "'00000000-0000-0000-0000-000000000000'"},
			{name: "c_json", sqlType: "json", full: `'{"a": "x\"y", "b": [1, 2]}'`, edge: "'[]'"},
			{name: "c_jsonb", sqlType: "jsonb", full: `'{"k": true, "n": {"deep": [1, "two", null]}}'`, edge: "'{}'"},
			{name: "c_bytea", sqlType: "bytea", full: `'\x00ff10'`, edge: `'\x'`},
			{name: "c_inet", sqlType: "inet", full: "'192.168.1.10'", edge: "'::1'"},
			{name: "c_cidr", sqlType: "cidr", full: "'10.0.0.0/8'", edge: "'::/0'"},
			{name: "c_macaddr", sqlType: "macaddr", full: "'08:00:2b:01:02:03'", edge: "'ff:ff:ff:ff:ff:ff'"},
			{name: "c_int_array", sqlType: "int[]", full: "'{1,2,NULL}'", edge: "'{}'"},
			{name: "c_text_array", sqlType: "text[]", full: `'{"a b","c,d"}'`, edge: "'{}'"},
			{name: "c_uuid_array", sqlType: "uuid[]", full: "'{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}'", edge: "'{}'"},
			{name: "c_jsonb_array", sqlType: "jsonb[]", full: `ARRAY['{"a": 1}'::jsonb]`, edge: "'{}'"},
			{name: "c_xml", sqlType: "xml", full: `'<r a="1">x</r>'`, edge: "'<e/>'"},
			{name: "c_point", sqlType: "point", full: "'(1.5,2)'", edge: "'(0,0)'"},
			{name: "c_box", sqlType: "box", full: "'((0,0),(1,1))'", edge: "'((0,0),(0,0))'"},
			{name: "c_circle", sqlType: "circle", full: "'<(1,1),2>'", edge: "'<(0,0),0>'"},
			{name: "c_line", sqlType: "line", full: "'{1,-1,0}'", edge: "'{0,1,0}'"},
			{name: "c_lseg", sqlType: "lseg", full: "'[(0,0),(1,1)]'", edge: "'[(0,0),(0,0)]'"},
			{name: "c_path", sqlType: "path", full: "'((0,0),(1,1),(2,0))'", edge: "'[(0,0),(1,1)]'"},
			{name: "c_polygon", sqlType: "polygon", full: "'((0,0),(1,1),(1,0))'", edge: "'((0,0),(1,0),(0,1))'"},
			{name: "c_tsvector", sqlType: "tsvector", full: "'a fat cat'", edge: "''"},
			{name: "c_int4range", sqlType: "int4range", full: "'[1,10)'", edge: "'empty'"},
			{name: "c_tstzrange", sqlType: "tstzrange", full: "'[2024-01-01 00:00+00,2024-02-01 00:00+00)'", edge: "'empty'"},
			{name: "c_daterange", sqlType: "daterange", full: "'[2024-01-01,2024-02-01)'", edge: "'empty'"},
			{name: "c_enum", sqlType: "mood_{suffix}", full: "'happy'", edge: "'sad'"},
			{name: "c_bit", sqlType: "bit(4)", full: "B'1010'", edge: "B'0000'"},
			{name: "c_varbit", sqlType: "varbit(8)", full: "B'101'", edge: "B''"},
			{name: "c_oid", sqlType: "oid", full: "12345", edge: "0"},
			generatedIntColumn,
		},
		update: "c_int = 0, c_text = 'changed', c_date = '2000-01-01', c_bytea = NULL, c_jsonb = '{}', c_int_array = '{9}', c_enum = 'ok', c_tstzrange = 'empty', c_polygon = NULL",
	},
	"mysql": {
		id:      "int AUTO_INCREMENT PRIMARY KEY",
		options: " CHARACTER SET utf8mb4",
		columns: withColumns(mysqlTypeColumns, generatedIntColumn),
		update:  "c_int = 0, c_text = 'changed', c_date = '2000-01-01', c_blob = NULL, c_json = '{}', c_set = 'y', c_point = ST_GeomFromText('POINT(5 5)'), c_bit64 = b'1'",
	},
	"mariadb": {
		id:      "int AUTO_INCREMENT PRIMARY KEY",
		options: " CHARACTER SET utf8mb4",
		columns: withColumns(mysqlTypeColumns,
			typeColumn{name: "c_uuid", sqlType: "uuid", full: "'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'", edge: "'00000000-0000-0000-0000-000000000000'"},
			typeColumn{name: "c_inet6", sqlType: "inet6", full: "'2001:db8::1'", edge: "'::ffff:10.0.0.1'"},
			typeColumn{name: "c_inet4", sqlType: "inet4", full: "'10.0.0.1'", edge: "'0.0.0.0'"},
			generatedIntColumn),
		update: "c_int = 0, c_text = 'changed', c_date = '2000-01-01', c_blob = NULL, c_json = '{}', c_set = 'y', c_uuid = NULL, c_inet4 = '1.2.3.4'",
	},
	"sqlserver": {
		id: "int IDENTITY(1,1) PRIMARY KEY",
		columns: []typeColumn{
			{name: "c_tinyint", sqlType: "tinyint", full: "1", edge: "0"},
			{name: "c_smallint", sqlType: "smallint", full: "2", edge: "-32768"},
			{name: "c_int", sqlType: "int", full: "3", edge: "-1000000000"},
			{name: "c_bigint", sqlType: "bigint", full: "9223372036854775807", edge: "-9223372036854775808"},
			{name: "c_decimal", sqlType: "decimal(12,4)", full: "12345678.1234", edge: "-0.0001"},
			{name: "c_bigdec", sqlType: "decimal(38,10)", full: "1234567890123456789012345678.1234567890", edge: "-0.0000000001"},
			{name: "c_numeric", sqlType: "numeric(10,2)", full: "12.34", edge: "-1.00"},
			{name: "c_float", sqlType: "float", full: "2.25", edge: "-1.25e10"},
			{name: "c_float_max", sqlType: "float", full: "1.7976931348623157E+308", edge: "-2.2250738585072014E-308"},
			{name: "c_real", sqlType: "real", full: "1.5", edge: "1e-30"},
			{name: "c_money", sqlType: "money", full: "12.3456", edge: "-922337203685477.5808"},
			{name: "c_smallmoney", sqlType: "smallmoney", full: "1.25", edge: "-214748.3648"},
			{name: "c_bit", sqlType: "bit", full: "1", edge: "0"},
			{name: "c_char", sqlType: "char(3)", full: "'abc'", edge: "'x'"},
			{name: "c_char_pad", sqlType: "char(10)", full: "'pad'", edge: "''"},
			{name: "c_varchar", sqlType: "varchar(50)", full: "'O''Neil'", edge: "''"},
			{name: "c_varchar_max", sqlType: "varchar(max)", full: "REPLICATE(CAST('x' AS varchar(max)), 9000)", edge: "''"},
			{name: "c_nchar", sqlType: "nchar(3)", full: "N'ğüş'", edge: "N''"},
			{name: "c_nvarchar", sqlType: "nvarchar(50)", full: "N'Ayşe O''Neil 😀'", edge: `N'ğüşİ ''q'' "dq"'`},
			{name: "c_nvarchar_max", sqlType: "nvarchar(max)", full: "N'line1\nline2 \\ back'", edge: "N''"},
			{name: "c_text", sqlType: "text", full: "'legacy text'", edge: "''"},
			{name: "c_ntext", sqlType: "ntext", full: "N'legacy ğ ntext'", edge: "N''"},
			{name: "c_date", sqlType: "date", full: "'2024-02-29'", edge: "'0001-01-01'"},
			{name: "c_time", sqlType: "time(3)", full: "'13:45:10.123'", edge: "'00:00:00'"},
			{name: "c_time7", sqlType: "time(7)", full: "'23:59:59.9999999'", edge: "'00:00:00.0000001'"},
			{name: "c_datetime", sqlType: "datetime", full: "'2024-03-01 10:15:30.250'", edge: "'1753-01-01 00:00:00'"},
			{name: "c_datetime2", sqlType: "datetime2(3)", full: "'2024-03-01 10:15:30.250'", edge: "'0001-01-01 00:00:00'"},
			{name: "c_datetime27", sqlType: "datetime2(7)", full: "'2024-03-01 10:15:30.1234567'", edge: "'9999-12-31 23:59:59.9999999'"},
			{name: "c_smalldatetime", sqlType: "smalldatetime", full: "'2024-03-01 10:15:00'", edge: "'1900-01-01 00:00:00'"},
			{name: "c_dto", sqlType: "datetimeoffset(3)", full: "'2024-03-01 10:15:30.250 +03:00'", edge: "'0001-01-01 00:00:00 +00:00'"},
			{name: "c_uuid", sqlType: "uniqueidentifier", full: "'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'", edge: "'00000000-0000-0000-0000-000000000000'"},
			{name: "c_binary", sqlType: "binary(4)", full: "0x00FF1000", edge: "0x00000000"},
			{name: "c_varbinary", sqlType: "varbinary(16)", full: "0x00FF10", edge: "0x"},
			{name: "c_varbinary_max", sqlType: "varbinary(max)", full: "CAST(REPLICATE(CAST('ab' AS varchar(max)), 4500) AS varbinary(max))", edge: "0x"},
			{name: "c_image", sqlType: "image", full: "0x0102", edge: "0x"},
			{name: "c_xml", sqlType: "xml", full: `N'<r a="1">x</r>'`, edge: "N'<e/>'"},
			{name: "c_variant", sqlType: "sql_variant", full: "CAST(42 AS int)", edge: "CAST(N'text variant' AS nvarchar(20))", csvLossy: true},
			{name: "c_hierarchy", sqlType: "hierarchyid", full: "'/1/2/'", edge: "'/'"},
			{name: "c_geography", sqlType: "geography", full: "geography::Point(41.0, 29.0, 4326)", edge: "geography::Point(0, 0, 4326)"},
			{name: "c_geometry", sqlType: "geometry", full: "geometry::STGeomFromText('LINESTRING(0 0, 1 1)', 0)", edge: "geometry::Point(0, 0, 0)"},
			{name: "c_rowversion", sqlType: "rowversion", computed: true, volatile: true},
			{name: "c_computed", sqlType: "AS (c_int * 2)", computed: true},
		},
		update: "c_int = 0, c_nvarchar = N'changed', c_date = '2000-01-01', c_varbinary = NULL, c_xml = N'<z/>', c_dto = NULL, c_variant = 7, c_geography = NULL, c_hierarchy = '/9/'",
	},
}
