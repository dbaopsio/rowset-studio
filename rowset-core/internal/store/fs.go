package store

import "os"

func fsMkdirAll(path string) error { return os.MkdirAll(path, 0o700) }
