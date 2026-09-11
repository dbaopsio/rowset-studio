package vault

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
)

var (
	ErrBadKey = errors.New("encryption key must be 32 bytes")
	ErrCrypto = errors.New("crypto operation failed")
)

// Vault intentionally uses the same AES-256-GCM layout as the Rust backend:
// a 12-byte nonce stored separately and ciphertext with the 16-byte tag
// appended. Existing encrypted connection passwords therefore remain valid.
type Vault struct {
	primary  cipher.AEAD
	previous cipher.AEAD
}

func New(key []byte, previous []byte) (*Vault, error) {
	primary, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	var old cipher.AEAD
	if len(previous) != 0 {
		old, err = newGCM(previous)
		if err != nil {
			return nil, fmt.Errorf("previous key: %w", err)
		}
	}
	return &Vault{primary: primary, previous: old}, nil
}

func newGCM(key []byte) (cipher.AEAD, error) {
	if len(key) != 32 {
		return nil, ErrBadKey
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, ErrBadKey
	}
	return cipher.NewGCM(block)
}

func (v *Vault) Encrypt(plaintext []byte) (ciphertext, nonce []byte, err error) {
	nonce = make([]byte, v.primary.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, ErrCrypto
	}
	return v.primary.Seal(nil, nonce, plaintext, nil), nonce, nil
}

func (v *Vault) Decrypt(ciphertext, nonce []byte) ([]byte, error) {
	plaintext, err := v.primary.Open(nil, nonce, ciphertext, nil)
	if err == nil {
		return plaintext, nil
	}
	if v.previous != nil {
		if plaintext, oldErr := v.previous.Open(nil, nonce, ciphertext, nil); oldErr == nil {
			return plaintext, nil
		}
	}
	return nil, ErrCrypto
}
