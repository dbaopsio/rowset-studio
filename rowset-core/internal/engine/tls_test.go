package engine

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"strings"
	"testing"
	"time"
)

type testIssuer struct {
	certificate *x509.Certificate
	key         *ecdsa.PrivateKey
	pem         string
}

func newTestCA(t *testing.T, name string) testIssuer {
	t.Helper()
	template := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: name}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	certificate, key, certPEM, _ := issueTestCertificate(t, template, nil, nil)
	return testIssuer{certificate: certificate, key: key, pem: certPEM}
}

func issueTestCertificate(t *testing.T, template *x509.Certificate, parent *x509.Certificate, parentKey *ecdsa.PrivateKey) (*x509.Certificate, *ecdsa.PrivateKey, string, string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if parent == nil {
		parent, parentKey = template, key
	}
	der, err := x509.CreateCertificate(rand.Reader, template, parent, &key.PublicKey, parentKey)
	if err != nil {
		t.Fatal(err)
	}
	certificate, _ := x509.ParseCertificate(der)
	keyDER, _ := x509.MarshalECPrivateKey(key)
	return certificate, key, string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})), string(pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}))
}

func (ca testIssuer) leaf(t *testing.T, serial int64, usage x509.ExtKeyUsage, dns ...string) (certPEM, keyPEM string) {
	t.Helper()
	template := &x509.Certificate{SerialNumber: big.NewInt(serial), Subject: pkix.Name{CommonName: "leaf"}, DNSNames: dns, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{usage}}
	_, _, certPEM, keyPEM = issueTestCertificate(t, template, ca.certificate, ca.key)
	return certPEM, keyPEM
}

// handshake returns the client and server results of one TLS handshake.
func handshake(t *testing.T, server *tls.Config, client *tls.Config) (clientErr, serverErr error) {
	t.Helper()
	listener, err := tls.Listen("tcp", "127.0.0.1:0", server)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	serverDone := make(chan error, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			serverDone <- err
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
		err = conn.(*tls.Conn).Handshake()
		if err == nil {
			// TLS 1.3 reports client-certificate rejection on the first read.
			_, err = conn.Write([]byte{1})
		}
		serverDone <- err
	}()
	conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 5 * time.Second}, "tcp", listener.Addr().String(), client)
	if err == nil {
		_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
		_, err = conn.Read(make([]byte, 1))
		conn.Close()
	}
	return err, <-serverDone
}

func TestTLSModesVerifyExactlyWhatTheyPromise(t *testing.T) {
	ca, other := newTestCA(t, "rowset-ca"), newTestCA(t, "attacker-ca")
	certPEM, keyPEM := ca.leaf(t, 2, x509.ExtKeyUsageServerAuth, "db.internal")
	serverPair, err := tls.X509KeyPair([]byte(certPEM), []byte(keyPEM))
	if err != nil {
		t.Fatal(err)
	}
	server := &tls.Config{Certificates: []tls.Certificate{serverPair}}
	cases := []struct {
		name     string
		settings TLSSettings
		host     string
		ok       bool
	}{
		{"verify-full trusted CA and host", TLSSettings{Mode: TLSVerifyFull, CAPEM: ca.pem}, "db.internal", true},
		{"verify-full rejects wrong host", TLSSettings{Mode: TLSVerifyFull, CAPEM: ca.pem}, "other.internal", false},
		{"verify-full server name override", TLSSettings{Mode: TLSVerifyFull, CAPEM: ca.pem, ServerName: "db.internal"}, "10.0.0.5", true},
		{"verify-full rejects untrusted CA", TLSSettings{Mode: TLSVerifyFull, CAPEM: other.pem}, "db.internal", false},
		{"verify-full rejects unknown CA with system roots", TLSSettings{Mode: TLSVerifyFull}, "db.internal", false},
		{"verify-ca ignores host", TLSSettings{Mode: TLSVerifyCA, CAPEM: ca.pem}, "other.internal", true},
		{"verify-ca rejects untrusted CA", TLSSettings{Mode: TLSVerifyCA, CAPEM: other.pem}, "db.internal", false},
		{"require encrypts without verification", TLSSettings{Mode: TLSRequire, CAPEM: other.pem}, "other.internal", true},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			config, err := tlsConfig(test.settings, test.host)
			if err != nil {
				t.Fatal(err)
			}
			clientErr, _ := handshake(t, server, config)
			if (clientErr == nil) != test.ok {
				t.Fatalf("handshake error = %v, want ok=%v", clientErr, test.ok)
			}
		})
	}
}

func TestTLSClientCertificateAndInvalidMaterial(t *testing.T) {
	ca := newTestCA(t, "rowset-ca")
	serverCert, serverKey := ca.leaf(t, 2, x509.ExtKeyUsageServerAuth, "db.internal")
	clientCert, clientKey := ca.leaf(t, 3, x509.ExtKeyUsageClientAuth)
	serverPair, _ := tls.X509KeyPair([]byte(serverCert), []byte(serverKey))
	roots := x509.NewCertPool()
	roots.AddCert(ca.certificate)
	server := &tls.Config{Certificates: []tls.Certificate{serverPair}, ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: roots}

	withCert, err := tlsConfig(TLSSettings{Mode: TLSVerifyFull, CAPEM: ca.pem, ClientCertPEM: clientCert, ClientKeyPEM: clientKey}, "db.internal")
	if err != nil {
		t.Fatal(err)
	}
	if clientErr, serverErr := handshake(t, server, withCert); clientErr != nil || serverErr != nil {
		t.Fatalf("mutual TLS failed: client=%v server=%v", clientErr, serverErr)
	}
	withoutCert, _ := tlsConfig(TLSSettings{Mode: TLSVerifyFull, CAPEM: ca.pem}, "db.internal")
	if clientErr, serverErr := handshake(t, server, withoutCert); clientErr == nil && serverErr == nil {
		t.Fatal("server accepted a client without a certificate")
	}

	if config, err := tlsConfig(TLSSettings{Mode: TLSDisable, CAPEM: "ignored"}, "db"); config != nil || err != nil {
		t.Fatalf("disable produced config=%v err=%v", config, err)
	}
	for name, settings := range map[string]TLSSettings{
		"bad CA":        {Mode: TLSVerifyFull, CAPEM: "not a certificate"},
		"half pair":     {Mode: TLSRequire, ClientCertPEM: clientCert},
		"mismatch pair": {Mode: TLSRequire, ClientCertPEM: clientCert, ClientKeyPEM: serverKey},
		"prefer mode":   {Mode: "prefer"},
	} {
		if err := ValidateTLSSettings(settings); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	if strings.Contains(poolKey(Connection{TLS: TLSSettings{Mode: TLSRequire, ClientKeyPEM: clientKey}}), "PRIVATE") {
		t.Fatal("pool key exposes TLS key material")
	}
	if poolKey(Connection{TLS: TLSSettings{Mode: TLSRequire}}) == poolKey(Connection{TLS: TLSSettings{Mode: TLSVerifyFull}}) {
		t.Fatal("changing TLS mode reuses the old pool")
	}
}
