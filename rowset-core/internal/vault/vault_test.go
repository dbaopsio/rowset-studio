package vault

import (
	"bytes"
	"testing"
)

func TestRoundTripAndPreviousKey(t *testing.T) {
	oldKey := bytes.Repeat([]byte{1}, 32)
	newKey := bytes.Repeat([]byte{2}, 32)
	old, err := New(oldKey, nil)
	if err != nil {
		t.Fatal(err)
	}
	ciphertext, nonce, err := old.Encrypt([]byte("connection-password"))
	if err != nil {
		t.Fatal(err)
	}
	rotated, err := New(newKey, oldKey)
	if err != nil {
		t.Fatal(err)
	}
	got, err := rotated.Decrypt(ciphertext, nonce)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "connection-password" {
		t.Fatalf("got %q", got)
	}
}

func TestRejectsWeakKey(t *testing.T) {
	if _, err := New([]byte("short"), nil); err != ErrBadKey {
		t.Fatalf("got %v", err)
	}
}
