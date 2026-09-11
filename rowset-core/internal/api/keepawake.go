package api

import "sync"

// awake keeps a desktop computer from sleeping while statements run, so a
// long query left running is not cut off by idle sleep.
type awake struct {
	mu      sync.Mutex
	holders int
	release func()
}

// holdAwake keeps the computer awake until the returned function is called.
// Only desktop installs do this; servers manage their own power settings.
func (s *Server) holdAwake() func() {
	if s.config.LocalLauncherKey == "" {
		return func() {}
	}
	s.awake.mu.Lock()
	s.awake.holders++
	if s.awake.holders == 1 {
		s.awake.release = preventSleep()
	}
	s.awake.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			s.awake.mu.Lock()
			defer s.awake.mu.Unlock()
			s.awake.holders--
			if s.awake.holders == 0 && s.awake.release != nil {
				s.awake.release()
				s.awake.release = nil
			}
		})
	}
}
