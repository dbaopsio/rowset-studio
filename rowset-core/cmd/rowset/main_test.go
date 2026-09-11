package main

import "testing"

func TestParseArgs(t *testing.T) {
	tests := []struct {
		args            []string
		command, config string
	}{
		{nil, defaultCommand, ""},
		{[]string{"--config", "/etc/rowset.env"}, defaultCommand, "/etc/rowset.env"},
		{[]string{"desktop-stop", "--config=/etc/rowset.env"}, "desktop-stop", "/etc/rowset.env"},
		{[]string{"--config", "rowset.env", "desktop"}, "desktop", "rowset.env"},
	}
	for _, test := range tests {
		command, config, err := parseArgs(test.args)
		if err != nil || command != test.command || config != test.config {
			t.Fatalf("args=%#v command=%q config=%q err=%v", test.args, command, config, err)
		}
	}
	if _, _, err := parseArgs([]string{"--config"}); err == nil {
		t.Fatal("missing config path accepted")
	}
	if _, _, err := parseArgs([]string{"desktop", "extra"}); err == nil {
		t.Fatal("extra argument accepted")
	}
}
